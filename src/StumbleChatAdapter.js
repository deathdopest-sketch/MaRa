'use strict';

// she found the room without knocking. classic mara.
// connects to YOUR already-running Chrome via CDP — no login, no puppeteer launch,
// just attaches to the tab you're already sitting in.

const { EventEmitter } = require('events');
const puppeteer        = require('puppeteer-core');
const WsListener       = require('./WsListener');

class StumbleChatAdapter extends EventEmitter {
  constructor(cdpPort, rooms) {
    super();
    this._cdpPort   = parseInt(cdpPort || process.env.CHROME_CDP_PORT || '9222', 10);
    this._rooms     = (rooms || []).map(r => r.toLowerCase());
    this._browser   = null;
    this._listeners = [];
  }

  async connect() {
    const browserURL = `http://127.0.0.1:${this._cdpPort}`;
    console.log(`[StumbleChat] Attaching to Chrome at ${browserURL}...`);

    try {
      this._browser = await puppeteer.connect({
        browserURL,
        defaultViewport: null,
      });
    } catch (e) {
      console.error(`[StumbleChat] Could not connect to Chrome at ${browserURL}`);
      console.error('  Make sure Chrome is running with --remote-debugging-port=' + this._cdpPort);
      console.error('  Use launch-chrome.bat (Windows) or see README for instructions.');
      throw e;
    }

    const pages = await this._browser.pages();
    const stumbleTabs = pages.filter(p => p.url().includes('stumblechat'));

    if (!stumbleTabs.length) {
      console.error('[StumbleChat] No StumbleChat tabs found. Open stumblechat.com and join a room first.');
      process.exit(1);
    }

    for (const page of stumbleTabs) {
      const url       = page.url();
      const match     = url.match(/\/room\/([^/?#]+)/i);
      const roomName  = (match ? match[1] : 'unknown').toLowerCase();

      if (this._rooms.length > 0 && !this._rooms.includes(roomName)) {
        console.log(`[StumbleChat] Skipping tab: ${roomName} (not in STUMBLECHAT_ROOMS)`);
        continue;
      }

      const listener = new WsListener(roomName, page, '_mara_', {
        onMessage  : (room, nick, text, handle) => this.emit('message',    { room, nick, text, handle }),
        onJoin     : (room, nick, handle, username, mod) => this.emit('join', { room, nick, handle, username, mod: mod || 0 }),
        onJoined   : (room, nick, handle) => this.emit('connected',  { room }),
        onLeave    : (room, nick, handle) => this.emit('leave',      { room, nick, handle }),
        onNickChange: (room, oldNick, newNick, handle) => this.emit('nickChange', { room, oldNick, newNick, handle }),
        onUserList : (room, users) => this.emit('userlist',   { room, users }),
        onSysMsg   : (room, text) => process.env.DEBUG_MARA && console.log(`[SysMsg:${room}] ${text}`),
        onBan      : (room, nick) => console.log(`[StumbleChat:${room}] BAN: ${nick}`),
        onKick     : (room, nick) => console.log(`[StumbleChat:${room}] KICK: ${nick}`),
      }, null);

      await listener.start();
      await listener.injectRelay().catch(() => {});
      this._listeners.push({ listener, roomName });

      this.emit('connected', { room: roomName });
      console.log(`[StumbleChat] Hooked into room: ${roomName} (tab: ${url.slice(0, 60)})`);
    }

    if (!this._listeners.length) {
      if (this._rooms.length > 0) {
        console.error(`[StumbleChat] No tabs matched rooms: ${this._rooms.join(', ')}`);
        console.error('  Either clear STUMBLECHAT_ROOMS or navigate to those rooms in Chrome.');
      } else {
        console.error('[StumbleChat] No StumbleChat room tabs found.');
      }
      process.exit(1);
    }
  }

  async disconnect() {
    for (const { listener } of this._listeners) {
      await listener.stop().catch(() => {});
    }
    // disconnect() not close() — we didn't open the browser, we don't close it
    try { this._browser?.disconnect(); } catch (_) {}
  }

  get rooms() {
    return this._listeners.map(l => l.roomName);
  }
}

module.exports = StumbleChatAdapter;
