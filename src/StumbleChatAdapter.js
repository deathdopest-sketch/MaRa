'use strict';

// she finds her own way in now. no bat file. no manual chrome. just credentials.
// auto-launches chrome, logs in with OWNER_ACCOUNT + OWNER_PASS, hooks the room.
// profile persists in data/chrome-profile so she stays logged in between runs.
// audio capture: hooks WebRTC audio tracks and feeds whisper transcriptions into the pipeline.

const { EventEmitter } = require('events');
const fs           = require('fs');
const path         = require('path');
const puppeteer    = require('puppeteer-core');
const WsListener   = require('./WsListener');
const AudioCapture = require('./AudioCapture');

function findChrome() {
  const override = process.env.CHROME_PATH;
  if (override && fs.existsSync(override)) return override;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

class StumbleChatAdapter extends EventEmitter {
  constructor(rooms, username, password, audioPipeline = null) {
    super();
    this._rooms    = (rooms || []).filter(Boolean);
    this._username = username || null;
    this._password = password || null;
    this._audio    = audioPipeline;   // AudioPipeline instance, or null
    this._browser  = null;
    this._listeners = [];
    this._owned    = false;

    if (this._audio) {
      this._audio.on('transcript', ({ room, text, trackId, handle, nick }) => {
        // nick from attribution; fall back to [voice] if genuinely unknown
        const displayNick = nick || (handle ? `[${handle}]` : '[voice]');
        this.emit('transcript', { room, nick: displayNick, text, trackId, handle });
      });
    }
  }

  async connect() {
    const executablePath = findChrome();
    if (!executablePath) {
      console.error('[StumbleChat] Chrome not found. Install Chrome or set CHROME_PATH in .env');
      process.exit(1);
    }

    if (!this._rooms.length) {
      console.error('[StumbleChat] Set STUMBLECHAT_ROOMS in .env (e.g. STUMBLECHAT_ROOMS=meatspace)');
      process.exit(1);
    }

    const profileDir = path.join(__dirname, '..', 'data', 'chrome-profile');
    fs.mkdirSync(profileDir, { recursive: true });

    console.log('[StumbleChat] Launching Chrome...');
    this._browser = await puppeteer.launch({
      executablePath,
      headless: false,
      userDataDir: profileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        // allow audio capture in the page
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream', // auto-allow mic/cam prompts in headless-like mode
      ],
      defaultViewport: null,
    });
    this._owned = true;

    if (this._username && this._password) {
      await this._ensureLoggedIn();
    }

    const [firstPage] = await this._browser.pages();
    for (let i = 0; i < this._rooms.length; i++) {
      const page = i === 0 ? firstPage : await this._browser.newPage();
      await this._openRoom(page, this._rooms[i]);
    }

    if (!this._listeners.length) {
      console.error('[StumbleChat] No rooms hooked — check STUMBLECHAT_ROOMS');
      process.exit(1);
    }
  }

  async _ensureLoggedIn() {
    const pages = await this._browser.pages();
    const page  = pages[0];

    await page.goto('https://stumblechat.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const needsLogin = await page.$('input[type="password"]').then(el => !!el);
    if (!needsLogin) {
      console.log('[StumbleChat] Already logged in.');
      return;
    }

    console.log(`[StumbleChat] Logging in as ${this._username}...`);

    for (const sel of ['input[name="username"]', 'input[name="user"]', '#username', 'input[type="text"]']) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(this._username, { delay: 40 });
        break;
      }
    }

    const pwEl = await page.$('input[type="password"]');
    if (pwEl) {
      await pwEl.click({ clickCount: 3 });
      await pwEl.type(this._password, { delay: 40 });
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ]);

    console.log(`[StumbleChat] Login submitted → ${page.url()}`);
  }

  async _openRoom(page, roomName) {
    const listener = new WsListener(roomName, page, '__mara_observer__', {
      onMessage   : (room, nick, text, handle) => this.emit('message',    { room, nick, text, handle }),
      onJoin      : (room, nick, handle, username, mod) => this.emit('join', { room, nick, handle, username, mod: mod || 0 }),
      onJoined    : (room, nick, handle) => this.emit('connected',  { room }),
      onLeave     : (room, nick, handle) => this.emit('leave',      { room, nick, handle }),
      onNickChange: (room, oldNick, newNick, handle) => this.emit('nickChange', { room, oldNick, newNick, handle }),
      onUserList  : (room, users) => this.emit('userlist',   { room, users }),
      onSysMsg    : (room, text) => process.env.DEBUG_MARA && console.log(`[SysMsg:${room}] ${text}`),
      onBan          : (room, nick) => console.log(`[StumbleChat:${room}] BAN: ${nick}`),
      onKick         : (room, nick) => console.log(`[StumbleChat:${room}] KICK: ${nick}`),
      // unknown frame types → emit for protocol change detection / logging
      onNewFrameType : (room, type, frame) => this.emit('unknownFrame', { room, type, frame }),
      // when someone turns on their mic, inject their identity into the page
      // so the next WebRTC track event can be attributed to them
      onCamOn     : (room, handle) => {
        const nick = listener.getNick(handle) || handle;
        capture?.notifySubscribe(handle, nick);
      },
    }, null);

    // audio capture — set up pre-navigation hooks first
    const capture = this._audio ? new AudioCapture(roomName, page) : null;

    await listener.preNavigate();
    await listener.start();
    if (capture) await capture.preNavigate();

    await page.goto(`https://stumblechat.com/room/${roomName}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await listener.injectRelay().catch(() => {});

    if (capture) {
      await capture.start();
      capture.on('chunk', ({ room, trackId, b64, sampleRate, handle, nick }) => {
        // if nick is still unknown at chunk time, try the nickMap one more time
        const resolvedNick = nick || listener.getNick(handle) || null;
        this._audio.receiveChunk(room, trackId, b64, sampleRate, handle, resolvedNick);
      });
    }

    this._listeners.push({ listener, capture, roomName });
    this.emit('connected', { room: roomName });
    console.log(`[StumbleChat] Hooked into room: ${roomName}${capture ? ' (audio on)' : ''}`);
  }

  async disconnect() {
    for (const { listener, capture } of this._listeners) {
      await listener.stop().catch(() => {});
      capture?.stop();
    }
    if (this._owned) {
      try { await this._browser?.close(); } catch (_) {}
    } else {
      try { this._browser?.disconnect(); } catch (_) {}
    }
  }

  get rooms() {
    return this._listeners.map(l => l.roomName);
  }
}

module.exports = StumbleChatAdapter;
