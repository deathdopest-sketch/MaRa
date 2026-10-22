'use strict';

// mara. she watches the room so you don't have to. built by death, runs for freddy.

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const RoomMood              = require('./src/RoomMood');
const RelationshipMap       = require('./src/RelationshipMap');
const UserProfiles          = require('./src/UserProfile');
const Dashboard             = require('./src/Dashboard');
const SocialIntelligence    = require('./src/SocialIntelligence');
const MaraAssociativeMemory = require('./MaraAssociativeMemory');
const ArcTracker            = require('./src/ArcTracker');

const PLATFORM   = (process.env.PLATFORM || 'chatcommon').toLowerCase();
const DATA_DIR   = process.env.MARA_DATA_DIR  || path.join(__dirname, 'data');
const REFRESH_MS = parseInt(process.env.MARA_REFRESH_MS || '2000', 10);
const OWNER      = (process.env.OWNER_ACCOUNT || '').toLowerCase();

fs.mkdirSync(DATA_DIR, { recursive: true });

// startup greeting
if (OWNER === 'freddysparks') {
  console.log('mara is online. she sees everything, freddy. everything.');
} else {
  console.log('mara is online. she sees everything.');
}

// ── Analyzer stack ────────────────────────────────────────────────────────────

const mood     = new RoomMood();
const relmap   = new RelationshipMap();
const profiles = new UserProfiles();
const social   = new SocialIntelligence();
const memory   = new MaraAssociativeMemory(console);
const arc      = new ArcTracker(profiles, social, relmap);
const dash     = new Dashboard(mood, profiles, relmap, social, memory, arc, { refreshMs: REFRESH_MS });

// ── Adapter factory ───────────────────────────────────────────────────────────

function makeChatCommonAdapter() {
  const ChatCommonAdapter = require('./src/ChatCommonAdapter');
  const user  = process.env.CHATCOMMON_USERNAME || process.env.MARA_CC_USERNAME;
  const pass  = process.env.CHATCOMMON_PASSWORD || process.env.MARA_CC_PASSWORD;
  const rooms = (process.env.CHATCOMMON_ROOMS   || process.env.MARA_CC_ROOMS || 'd_d')
    .split(',').map(r => r.trim().toLowerCase()).filter(Boolean);

  if (!user || !pass) {
    console.error('[mara] CHATCOMMON_USERNAME and CHATCOMMON_PASSWORD must be set');
    process.exit(1);
  }
  return new ChatCommonAdapter(user, pass, rooms);
}

function makeMumbleAdapter() {
  const MumbleAdapter = require('./src/MumbleAdapter');
  const key    = process.env.MUMBLECHAT_BOT_KEY;
  const server = process.env.MUMBLECHAT_SERVER_URL || 'https://mumblechat.online';
  const rooms  = (process.env.MUMBLECHAT_ROOMS || 'ddd')
    .split(',').map(r => r.trim().toLowerCase()).filter(Boolean);

  if (!key) {
    console.error('[mara] MUMBLECHAT_BOT_KEY must be set for mumble platform');
    process.exit(1);
  }
  return new MumbleAdapter(server, key, rooms);
}

async function makeStumbleAdapter() {
  const StumbleChatAdapter = require('./src/StumbleChatAdapter');
  const AudioPipeline      = require('./src/AudioPipeline');

  const rooms    = (process.env.STUMBLECHAT_ROOMS || '')
    .split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
  const username = process.env.OWNER_ACCOUNT || process.env.STUMBLECHAT_USERNAME || '';
  const password = process.env.OWNER_PASS    || process.env.STUMBLECHAT_PASSWORD || '';

  // audio pipeline — init loads whisper (or skips gracefully if not installed)
  const audio = new AudioPipeline(DATA_DIR);
  await audio.init();

  return new StumbleChatAdapter(rooms, username, password, audio.ready ? audio : null);
}

// ── Wire adapter events → analyzers ──────────────────────────────────────────

function wireAdapter(adapter) {
  for (const room of adapter.rooms) {
    dash.addRoom(room);
  }

  arc.on('alert', ({ room, level, text }) => dash.pushAlert({ room, level, text }));

  // recent speakers per room for relationship proximity detection
  const recentSpeakers = new Map();

  adapter.on('message', ({ room, nick, text }) => {
    mood.observe(room, nick, text);
    profiles.observe(room, nick, text);
    social.observe(room, nick, text);
    memory.store(nick.toLowerCase(), nick, text, room, _msgImportance(text));

    if (!recentSpeakers.has(room)) recentSpeakers.set(room, []);
    const recent = recentSpeakers.get(room);
    recent.push(nick);
    if (recent.length > 5) recent.shift();

    relmap.observe(room, nick, text, [...recent]);
    arc.observe(room, nick, text, [...recent]);
    dash.pushFeed(room, nick, text);
  });

  adapter.on('join', ({ room, nick }) => {
    profiles.onJoin(room, nick);
    dash.addRoom(room);
  });

  adapter.on('leave', ({ room, nick }) => {
    profiles.onLeave(room, nick);
  });

  adapter.on('nickChange', ({ room, oldNick, newNick }) => {
    profiles.onNickChange(room, oldNick, newNick);
  });

  // unknown stumble frame types — log once per type for protocol change detection
  const _seenFrameTypes = new Set();
  adapter.on('unknownFrame', ({ room, type, frame }) => {
    if (_seenFrameTypes.has(type)) return;
    _seenFrameTypes.add(type);
    const entry = { ts: new Date().toISOString(), room, type, frame };
    const file  = path.join(DATA_DIR, 'unknown_frames.jsonl');
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    console.log(`[proto] new frame type discovered: "${type}" — logged to unknown_frames.jsonl`);
  });

  // spoken audio — same analysis pipeline as text, shown with 🎤 in feed
  adapter.on('transcript', ({ room, nick, text }) => {
    mood.observe(room, nick, text);
    profiles.observe(room, nick, text);
    social.observe(room, nick, text);
    memory.store(nick.toLowerCase(), nick, text, room, _msgImportance(text));
    relmap.observe(room, nick, text, []);
    arc.observe(room, nick, text, []);
    dash.pushFeed(room, `🎤 ${nick}`, text);
  });

  adapter.on('userlist', ({ room, users }) => {
    dash.addRoom(room);
    for (const u of (users || [])) profiles.onJoin(room, u.nick);
  });

  adapter.on('connected',    ({ room }) => room && dash.addRoom(room));
  adapter.on('disconnected', ({ room }) => {});
}

// ── Importance heuristic for memory storage ───────────────────────────────────

function _msgImportance(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const excl  = (text.match(/[!?]/g) || []).length;
  const caps  = (text.match(/[A-Z]/g) || []).length;
  return Math.min(0.9, 0.2 + Math.min(words / 50, 0.4) + excl * 0.05 + (caps > 5 ? 0.15 : 0));
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

function saveSnapshot() {
  try {
    const ts   = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(DATA_DIR, `mara_snapshot_${ts}.json`);
    const data = {
      savedAt:       new Date().toISOString(),
      mood:          mood.snapshot(),
      relationships: relmap.snapshot(),
      profiles:      profiles.snapshot(),
      social:        social.snapshot(),
      arcs:          arc.snapshot(),
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`[mara] snapshot saved → ${file}`);
  } catch (e) {
    console.error('[mara] snapshot failed:', e.message);
  }
}

setInterval(saveSnapshot, 10 * 60_000);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const adapters = [];

  if (PLATFORM === 'chatcommon' || PLATFORM === 'both') {
    const cc = makeChatCommonAdapter();
    wireAdapter(cc);
    adapters.push(cc);
    await cc.connect();
  }

  if (PLATFORM === 'mumble' || PLATFORM === 'both') {
    const mc = makeMumbleAdapter();
    wireAdapter(mc);
    adapters.push(mc);
    await mc.connect();
  }

  if (PLATFORM === 'stumblechat' || PLATFORM === 'stumble') {
    const sc = await makeStumbleAdapter();
    wireAdapter(sc);
    adapters.push(sc);
    await sc.connect();
  }

  if (!adapters.length) {
    console.error('[mara] no adapters started — check PLATFORM in .env');
    process.exit(1);
  }

  dash.start();

  async function shutdown(sig) {
    console.log(`\n[mara] ${sig} — saving snapshot and shutting down`);
    saveSnapshot();
    memory.destroy();
    dash.stop();
    for (const a of adapters) {
      try { await a.disconnect(); } catch (_) {}
    }
    process.exit(0);
  }

  process.once('SIGINT',  () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[mara] fatal:', err);
  process.exit(1);
});
