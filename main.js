'use strict';

require('dotenv').config();

const path                = require('path');
const ChatCommonClient    = require('./lib/ChatCommonClient');
const OllamaClient        = require('./lib/OllamaClient');
const ConversationHistory = require('./lib/ConversationHistory');
const { createMara }      = require('./index');
const MaraSniff           = require('./MaraSniff');
const MaraVulnScan        = require('./MaraVulnScan');
const MaraActuator        = require('./MaraActuator');

// ── Logger ────────────────────────────────────────────────────────────────────
const log = {
  info : (...a) => console.log ('[INFO]',  new Date().toISOString(), ...a),
  warn : (...a) => console.warn ('[WARN]',  new Date().toISOString(), ...a),
  error: (...a) => console.error('[ERROR]', new Date().toISOString(), ...a),
  debug: process.env.DEBUG_MARA
    ? (...a) => console.log('[DEBUG]', new Date().toISOString(), ...a)
    : () => {},
};

// ── Config ────────────────────────────────────────────────────────────────────
const CC_USERNAME   = process.env.MARA_CC_USERNAME;
const CC_PASSWORD   = process.env.MARA_CC_PASSWORD;
const CC_ROOMS      = (process.env.MARA_CC_ROOMS || 'd_d,n_n').split(',').map(s => s.trim()).filter(Boolean);
// Optional per-room passwords: MARA_ROOM_PASSWORDS=roomname:pass,room2:pass2
const CC_ROOM_PASSWORDS = Object.fromEntries(
  (process.env.MARA_ROOM_PASSWORDS || '').split(',')
    .map(s => s.trim()).filter(s => s.includes(':'))
    .map(s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; })
);
const MARA_NICK     = process.env.MARA_NICK || 'Mara';
const OLLAMA_HOST   = process.env.MARA_OLLAMA_HOST || '127.0.0.1:11434';
const MARA_MODEL    = process.env.MARA_MODEL || 'dolphin3:8b';
const OWNER_HANDLES = new Set(
  (process.env.MARA_OWNER_HANDLES || '').split(',').map(s => s.trim()).filter(Boolean)
);

if (!CC_USERNAME || !CC_PASSWORD) {
  log.error('MARA_CC_USERNAME and MARA_CC_PASSWORD must be set in .env');
  process.exit(1);
}

// ── Services ──────────────────────────────────────────────────────────────────
const ccClient = new ChatCommonClient(CC_USERNAME, CC_PASSWORD, log);
const ollama   = new OllamaClient({
  host         : OLLAMA_HOST,
  model        : MARA_MODEL,
  fallbackModel: process.env.MARA_MODEL_FALLBACK || MARA_MODEL,
  fastModel    : MARA_MODEL,
  maxTokens    : 80,
  temperature  : 0.91,
  repeatPenalty: 1.3,
  timeoutMs    : 45000,
}, log);

const history = new ConversationHistory(50, 20 * 60 * 1000);

// ── Bot interface ─────────────────────────────────────────────────────────────
const bot = {
  log,
  nick        : MARA_NICK,
  roomPersonas: new Map(),
  _ccClient   : ccClient,
  ollama,
  aiService   : ollama,
  history,

  send(roomName, text) { return ccClient.send(roomName, text); },

  pm(toNick, toHandle, text) { return ccClient.sendPrivateMessage(toNick, toHandle, text); },

  setNick(nick) {
    ccClient._send({ type: 'set_nickname', nickname: nick });
    ccClient._send({ type: 'change_nick',  nick });
  },

  identityRegistry: {
    death: { role: 'owner', handles: [...OWNER_HANDLES] },
  },
};

// ── Create Mara ───────────────────────────────────────────────────────────────
const mara = createMara(bot, { rooms: CC_ROOMS.join(','), logger: log });

// ── Sniff module ──────────────────────────────────────────────────────────────
const sniff    = new MaraSniff(ccClient, log);
sniff.attach();

const vulnscan = new MaraVulnScan(ccClient, sniff, log);

const actuator = new MaraActuator({
  ccClient,
  socialCtx : mara.socialCtx,
  memory    : mara.memory,
  history,
  ownerHandles: OWNER_HANDLES,
  log,
});

const SNIFF_RECIPIENTS = ['adminisRaToR'];
const VULN_AUTHORITIES = ['adminisRaToR'];  // death/d_d added automatically as requester

// ── Shared Ollama call (room + DM) ────────────────────────────────────────────
let _ollamaBusy   = false;
const _liveAfter  = Date.now() + 8000;  // ignore room-history replay for first 8s

async function _askOllama(histKey, nick, text, systemPrompt, replyFn) {
  if (!ollama.available) { log.warn('[main] Ollama not available'); return; }
  if (_ollamaBusy)       { log.debug('[main] Ollama busy — dropped'); return; }

  const contextType = text.length < 40 ? 'banter' : 'normal';
  history.addUser(histKey, nick, text);
  const messages = history.buildMessages(histKey, systemPrompt);

  _ollamaBusy = true;
  try {
    const response = await ollama.chatAdaptive(messages, contextType, { temperature: 0.91 });
    if (response) {
      replyFn(response);
      history.addAssistant(histKey, response);
    }
  } catch (err) {
    log.error('[main] Ollama error:', err.message);
  } finally {
    _ollamaBusy = false;
  }
}

// ── Room message handler ──────────────────────────────────────────────────────
const _origOnMessage = ccClient.cb.onMessage;

ccClient.cb.onMessage = async function (roomName, nick, text, handle) {
  if (_origOnMessage) _origOnMessage(roomName, nick, text, handle);

  if (!CC_ROOMS.includes(roomName)) return;
  if (!text?.trim()) return;

  // Skip own messages (server echoes them back)
  const _myU = (ccClient._myUsername || CC_USERNAME || '').toLowerCase();
  if (nick.toLowerCase() === _myU) return;

  // .sniff / .vulnscan — owner only (skip if still replaying room history)
  if (text.trim().toLowerCase().startsWith('.sniff') || text.trim().toLowerCase().startsWith('.vulnscan')) {
    if (Date.now() < _liveAfter) return;
    if (!OWNER_HANDLES.has(String(handle)) && !OWNER_HANDLES.has(nick.toLowerCase())) {
      ccClient.send(roomName, 'no.');
      return;
    }

    const cmd = text.trim().toLowerCase().split(/\s+/)[0];

    if (cmd === '.sniff') {
      ccClient.send(roomName, 'yes D <3');
      const extras = SNIFF_RECIPIENTS.map(n => ({
        nick  : n,
        handle: ccClient.getHandle(roomName, n) || n,
      }));
      sniff.sendReport(nick, handle, extras).catch(err => log.error('[sniff] error:', err.message));
    }

    if (cmd === '.vulnscan') {
      ccClient.send(roomName, 'starting vuln scan. consent request going out for breach tier.');
      const authorities = VULN_AUTHORITIES.map(n => ({
        nick  : n,
        handle: ccClient.getHandle(roomName, n) || n,
      }));
      vulnscan.run(nick, handle, authorities).catch(err => log.error('[vulnscan] error:', err.message));
    }

    return;
  }

  // Full Mara pipeline
  const isOwner  = OWNER_HANDLES.has(String(handle)) || OWNER_HANDLES.has(nick.toLowerCase());
  const assocHint = await (mara.assocMemory?.getContextHint?.(text, handle) ?? Promise.resolve(''));
  const result   = mara.process(text, { roomName, senderHandle: handle, senderNick: nick, botNick: MARA_NICK, assocHint });

  // Acronym short-circuit
  if (result.acronymResponse !== undefined) {
    if (result.acronymResponse) {
      ccClient.send(roomName, result.acronymResponse);
      history.addAssistant(`cc:${roomName}::mara`, result.acronymResponse);
    }
    return;
  }

  // Tool actuator — execute detected intent before Ollama
  const action = actuator.execute(result.toolAction, text, { roomName, senderHandle: handle, senderNick: nick, isOwner });

  if (action.mode === 'act') {
    // Direct action (kick/ban) — skip Ollama, send reply if any
    if (action.reply) ccClient.send(roomName, action.reply);
    return;
  }

  // Build final system prompt — inject live tool data if any
  const finalPrompt = action.mode === 'inject' && action.inject
    ? result.systemPrompt + '\n\n[LIVE DATA — use this to answer accurately, do not quote it verbatim]:\n' + action.inject
    : result.systemPrompt;

  await _askOllama(
    `cc:${roomName}::mara`,
    nick,
    text,
    finalPrompt,
    (reply) => ccClient.send(roomName, reply),
  );
};

// ── Private message handler ───────────────────────────────────────────────────
ccClient.cb.onPrivateMessage = async function (fromNick, fromHandle, text) {
  if (!text?.trim()) return;
  log.info(`[CC:DM] <${fromNick}> ${text.slice(0, 100)}`);

  // Route consent replies to vulnscan before anything else
  if (vulnscan.handlePM(fromNick, fromHandle, text)) return;

  const dmHistKey = `dm:${fromNick.toLowerCase()}`;

  const assocHint = await (mara.assocMemory?.getContextHint?.(text, fromHandle) ?? Promise.resolve(''));
  const result = mara.process(text, {
    roomName    : `_dm_${fromNick.toLowerCase()}`,
    senderHandle: fromHandle,
    senderNick  : fromNick,
    botNick     : MARA_NICK,
    assocHint,
  });

  // Acronym in DM
  if (result.acronymResponse !== undefined) {
    if (result.acronymResponse) {
      ccClient.sendPrivateMessage(fromNick, fromHandle, result.acronymResponse);
      history.addAssistant(dmHistKey, result.acronymResponse);
    }
    return;
  }

  await _askOllama(
    dmHistKey,
    fromNick,
    text,
    result.systemPrompt,
    (reply) => ccClient.sendPrivateMessage(fromNick, fromHandle, reply),
  );
};

// ── Presence callbacks ────────────────────────────────────────────────────────
ccClient.cb.onJoin = function (roomName, nick, handle, username, mod, meta) {
  if (!CC_ROOMS.includes(roomName)) return;
  // Feed social context (already done in MaraChatCommon but wire here too for safety)
  try { mara.socialCtx?.observe(roomName, nick, handle, ''); } catch { /* optional */ }
};

ccClient.cb.onLeave = function (roomName, nick, handle) {
  log.debug(`[CC] leave ${roomName} — ${nick}`);
};

ccClient.cb.onNickChange = function (roomName, oldNick, newNick, handle) {
  log.info(`[CC] nick change ${roomName} — ${oldNick} → ${newNick}`);
};

ccClient.cb.onUserList = function (roomName, users) {
  log.debug(`[CC] user list ${roomName} — ${users.length} users`);
};

// ── Connection lifecycle callbacks ────────────────────────────────────────────
ccClient.cb.onClosed = function (roomName) {
  log.warn(`[CC] disconnected from ${roomName} — reconnect pending`);
};

ccClient.cb.onReconnected = function (roomName) {
  log.info(`[CC] reconnected to ${roomName}`);
};

// ── Friend requests ───────────────────────────────────────────────────────────
ccClient.cb.onFriendRequest = function (fromNick, fromHandle, requestId) {
  log.info(`[CC] friend request from ${fromNick} (${fromHandle}) — auto-accepted`);
};

// ── Notifications ─────────────────────────────────────────────────────────────
ccClient.cb.onNotification = function (subType, data) {
  log.info(`[CC:Notification] subType=${subType} data=${JSON.stringify(data).slice(0, 200)}`);
};

// ── WebRTC signals ────────────────────────────────────────────────────────────
ccClient.cb.onRtcSignal = function (msg) {
  log.debug(`[CC:RTC] type=${msg.type} keys=${Object.keys(msg).join(',')}`);
};

// ── Health check — every 4 hours ─────────────────────────────────────────────
const HEALTH_INTERVAL_MS = 4 * 60 * 60_000;
setInterval(() => {
  const connected    = ccClient.isConnected;
  const joined       = [...ccClient._joinedRooms];
  const missing      = CC_ROOMS.filter(r => !ccClient._joinedRooms.has(r));
  log.info(`[CC:Health] connected=${connected} joined=[${joined.join(',')}] missing=[${missing.join(',')}]`);
  if (!connected) {
    log.warn('[CC:Health] not connected — triggering reconnect');
    ccClient.connect().catch(() => {});
  } else if (missing.length) {
    log.warn(`[CC:Health] re-joining: ${missing.join(', ')}`);
    for (const r of missing) ccClient.joinRoom(r);
  }
}, HEALTH_INTERVAL_MS);

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  log.info('[Mara] Checking Ollama...');
  await ollama.checkAvailable();

  log.info('[Mara] Connecting to ChatCommon...');
  for (const room of CC_ROOMS) ccClient.joinRoom(room, CC_ROOM_PASSWORDS[room]);
  await ccClient.connect();

  log.info(`[Mara] Online — rooms: ${CC_ROOMS.join(', ')} | model: ${ollama.config.model}`);
}

// ── Shutdown ──────────────────────────────────────────────────────────────────
function shutdown(sig) {
  log.info(`[Mara] ${sig} — shutting down`);
  mara.destroy?.();
  ccClient.disconnect().finally(() => process.exit(0));
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'EBADF') return;
  log.error('[Mara] Uncaught exception:', err.message, err.stack || '');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('[Mara] Unhandled rejection:', reason);
});

start().catch(err => {
  log.error('[Mara] Startup failed:', err.message);
  process.exit(1);
});
