'use strict';

// MaraChatCommon — ChatCommon room integration for Mara
// Mirrors LillyMumbleChat.js pattern but wired to bot._ccClient
// Reads MARA_CC_ROOMS env var (comma-separated: d_d,n_n)

const MARA_CC_ROOMS = (process.env.MARA_CC_ROOMS || process.env.SLASHA_CC_ROOMS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Cool, dark entry lines — not Lilly-bubbly, just presence
const JOIN_LINES = [
  'here.',
  '*settles in*',
  'what did I miss.',
  'interesting crowd.',
  null, // silent join — just watch
  null,
  null, // silence is more common than announcing
];

// No farewell lines — Mara just disappears
// Announcing departure is a tell

function _randomJoinLine() {
  const filtered = JOIN_LINES.filter(x => x !== null);
  // 40% chance of silent entry
  if (Math.random() < 0.4) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Attach Mara to ChatCommon rooms on the existing _ccClient.
 * Called after SpackleBot finishes its ChatCommon setup.
 *
 * @param {object} bot  SpackleBot instance
 * @param {object} opts { logger, memory, socialCtx }
 */
function attachMaraChatCommon(bot, opts = {}) {
  const log       = opts.logger    || bot.log;
  const memory    = opts.memory    || null;
  const socialCtx = opts.socialCtx || null;

  if (!MARA_CC_ROOMS.length) {
    log?.info('[MaraChatCommon] MARA_CC_ROOMS not set — skipping CC room attachment');
    return;
  }

  const ccClient = bot._ccClient;
  if (!ccClient) {
    log?.warn('[MaraChatCommon] bot._ccClient not available — ChatCommon client not started');
    return;
  }

  // Pin Mara persona to her ChatCommon rooms
  for (const room of MARA_CC_ROOMS) {
    if (bot.roomPersonas) bot.roomPersonas.set(room, 'mara');
    log?.info(`[MaraChatCommon] pinned mara → ${room}`);
  }

  // Hook into CC join events (bot's own join confirmation)
  const _origOnJoined = ccClient.cb?.onJoined;
  ccClient.cb = ccClient.cb || {};

  ccClient.cb.onJoined = function (roomName, nick, handle, username) {
    if (_origOnJoined) _origOnJoined(roomName, nick, handle, username);

    if (!MARA_CC_ROOMS.includes(roomName)) return;

    // Mara joined — silent or one short line
    const line = _randomJoinLine();
    if (line) {
      setTimeout(() => {
        try { ccClient.send(roomName, line); }
        catch (e) { log?.warn(`[MaraChatCommon] send error: ${e.message}`); }
      }, 1200 + Math.random() * 800);
    }

    log?.debug(`[MaraChatCommon] joined ${roomName} as ${nick}`);
  };

  // Hook into user join events to build dossier passively
  const _origOnJoin = ccClient.cb?.onJoin;
  ccClient.cb.onJoin = function (roomName, nick, handle, username, mod, meta) {
    if (_origOnJoin) _origOnJoin(roomName, nick, handle, username, mod, meta);
    if (!MARA_CC_ROOMS.includes(roomName)) return;
    if (memory) memory.upsert(handle, nick, roomName);
  };

  // Hook into message events — feed socialCtx so room intel is based on live messages
  const _origOnMessage = ccClient.cb?.onMessage;
  ccClient.cb.onMessage = function (roomName, nick, text, handle) {
    if (_origOnMessage) _origOnMessage(roomName, nick, text, handle);
    if (!MARA_CC_ROOMS.includes(roomName)) return;
    if (socialCtx) socialCtx.observe(roomName, nick, handle, text);
  };

  log?.info(`[MaraChatCommon] attached to rooms: ${MARA_CC_ROOMS.join(', ')}`);
}

module.exports = { attachMaraChatCommon, MARA_CC_ROOMS };
