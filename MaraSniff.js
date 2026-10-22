'use strict';

// MaraSniff — passive data collector + active probe for .sniff command
// Authorized for use on this site by the site owner.

const https = require('https');
const http  = require('http');

// ── Tiny HTTP fetch helper ────────────────────────────────────────────────────
function httpGet(url, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept'    : 'application/json, text/html, */*',
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── HTTP API paths to probe on chatcommon.com ─────────────────────────────────
const HTTP_PROBES = [
  // Room endpoints
  '/api/rooms',
  '/api/room/list',
  '/api/v1/rooms',
  '/api/v2/rooms',
  '/rooms',
  '/api/rooms/public',
  '/api/rooms/all',
  // User endpoints
  '/api/users',
  '/api/users/online',
  '/api/v1/users',
  '/api/online',
  '/api/online-users',
  // Stats
  '/api/stats',
  '/api/server/stats',
  '/api/v1/stats',
  '/stats',
  // Site info
  '/api/config',
  '/api/settings',
  '/api/site',
  '/api/info',
  // Admin
  '/api/admin/users',
  '/api/admin/rooms',
  '/api/admin/stats',
  '/admin/api/users',
  // Auth / account
  '/api/me',
  '/api/profile',
  '/api/account',
  '/api/v1/me',
];

// WS message types to probe for profile/history/admin data
const WS_USER_PROFILE_TYPES   = ['get_profile','user_profile','profile','get_user','user_info'];
const WS_ROOM_HISTORY_TYPES   = ['get_history','room_history','get_messages','message_history','chat_history'];
const WS_MOD_TYPES            = ['get_mods','room_mods','get_moderators','moderator_list'];
const WS_BAN_TYPES            = ['get_bans','ban_list','get_banned','banned_users'];
const WS_ADMIN_TYPES          = ['admin_stats','get_admin','admin_info','admin_users','get_all_users','admin_room_list'];
const WS_SEARCH_TYPES         = ['search_users','find_user','user_search'];
const WS_ROOM_DETAIL_TYPES    = ['get_room_info','room_details','get_room','room_info'];

class MaraSniff {
  constructor(ccClient, log) {
    this._cc  = ccClient;
    this.log  = log;

    // Passive stream data
    this._rooms           = new Map();
    this._socialSync      = null;
    this._roomLimits      = new Map();
    this._userLists       = new Map();
    this._liveLog         = [];
    this._ytQueues        = new Map();
    this._globalBroadcast = [];
    this._siteTotals      = {};
    this._profileReplies  = new Map();  // handle → profile data
    this._historyReplies  = new Map();  // room → messages[]
    this._modReplies      = new Map();  // room → mods[]
    this._banReplies      = new Map();  // room → bans[]
    this._unknownReplies  = [];         // catch-all for unrecognised response types
    this._friendStatus    = new Map();  // nick → status/mood/room
    this._httpResults     = [];
    this._roomAutomation  = new Map();  // room → { autoResponders, customEmojis, soundboard }
    this._networkNews     = [];         // site-wide news entries
    this._seenUsers       = new Map();  // username → { nick, style, status, idle_since } — enumerated from style updates

    this._attached = false;
  }

  // ── Attach to client dispatch pipeline ───────────────────────────────────────

  attach() {
    if (this._attached) return;
    this._attached = true;

    const cc   = this._cc;
    const self = this;

    const _origDispatch = cc._dispatch.bind(cc);
    cc._dispatch = function (msg) {
      self._tap(msg);
      _origDispatch(msg);
    };

    const _origOnUserList = cc.cb.onUserList;
    cc.cb.onUserList = function (roomName, users) {
      self._userLists.set(roomName, users);
      if (_origOnUserList) _origOnUserList(roomName, users);
    };

    this.log?.info('[MaraSniff] attached — passive collection active');
  }

  // ── Tap ALL raw WS messages ───────────────────────────────────────────────────

  _tap(msg) {
    const t = msg.type;
    if (!t) return;

    switch (t) {

      case 'room_list_batch': {
        if (msg.global_broadcasters?.length) {
          this._globalBroadcast = msg.global_broadcasters;
        }
        if (msg.totals) {
          Object.assign(this._siteTotals, msg.totals);
        }
        for (const r of (msg.rooms || [])) {
          const name = r.name || r.room || r.roomName || r.id;
          if (!name) continue;
          this._rooms.set(name, {
            name,
            userCount  : r.userCount ?? r.user_count ?? r.count ?? r.users?.length ?? '?',
            camCount   : r.camCount  ?? r.cam_count  ?? '?',
            description: r.description || r.bio || '',
            locked     : r.locked  ?? false,
            owner      : r.owner   || r.ownerUsername || '',
            ownerPic   : r.ownerPic || '',
            nsfw       : r.nsfw    ?? r.adult ?? false,
            topic      : r.topic   || '',
            created    : r.created || r.createdAt || '',
            raw        : r,
          });
        }
        break;
      }

      case 'social_sync': {
        this._socialSync = {
          friends       : msg.friends        || [],
          onlineFriends : msg.online_friends || msg.onlineFriends || [],
          friendData    : msg.friend_data    || msg.friendData    || {},
          tabs          : msg.tabs           || [],
          requests      : msg.requests       || [],
          capturedAt    : new Date().toISOString(),
        };
        // Index friend detail by nick for easy lookup
        const fd = this._socialSync.friendData;
        if (fd && typeof fd === 'object') {
          for (const [key, val] of Object.entries(fd)) {
            if (val?.username) this._friendStatus.set(val.username, val);
          }
        }
        break;
      }

      case 'friend_status_update': {
        const nick = msg.username || msg.nickname || msg.nick;
        if (nick) this._friendStatus.set(nick, msg);
        break;
      }

      case 'update_room_limits': {
        const room = msg._batchRoom || msg.room || this._cc._getPrimaryRoom();
        if (room) this._roomLimits.set(room, msg);
        break;
      }

      case 'youtube_queue_updated': {
        const room = msg._batchRoom || msg.room || this._cc._getPrimaryRoom();
        if (room && msg.queue !== undefined) {
          this._ytQueues.set(room, { queue: msg.queue, current: msg.currentlyPlaying, raw: msg });
        }
        break;
      }

      case 'live_log_push': {
        if (msg.entry) {
          this._liveLog.push({ room: msg._batchRoom, entry: msg.entry, ts: Date.now() });
          if (this._liveLog.length > 100) this._liveLog.shift();
        }
        break;
      }

      case 'room_automation_sync': {
        const room = msg._batchRoom || msg.room;
        if (room) {
          this._roomAutomation.set(room, {
            autoResponders: msg.autoResponders || [],
            customEmojis  : msg.customEmojis   || [],
            soundboard    : msg.soundboard      || [],
            raw           : msg,
          });
        }
        break;
      }

      case 'network_news_data': {
        const news = msg.news;
        if (news) {
          const entries = Array.isArray(news) ? news : [news];
          for (const e of entries) {
            if (!this._networkNews.find(n => JSON.stringify(n) === JSON.stringify(e))) {
              this._networkNews.push(e);
            }
          }
        }
        break;
      }

      case 'user_style_update': {
        const uname = msg.username;
        if (uname) {
          this._seenUsers.set(uname, {
            nick       : msg.nickname    || uname,
            style      : msg.style       || null,
            appearance : msg.displayAppearance || null,
            status_type: msg.status_type || null,
            idle_since : msg.idle_since  || null,
            seenAt     : Date.now(),
          });
        }
        break;
      }

      // Profile responses
      case 'profile':
      case 'user_profile':
      case 'profile_data':
      case 'user_info':
      case 'get_profile': {
        const handle = String(msg.userId || msg.user_id || msg.id || msg.username || '');
        if (handle) this._profileReplies.set(handle, msg);
        break;
      }

      // History responses
      case 'history':
      case 'room_history':
      case 'message_history':
      case 'chat_history':
      case 'messages': {
        const room = msg._batchRoom || msg.room || msg.roomName || this._cc._getPrimaryRoom();
        if (room) this._historyReplies.set(room, msg.messages || msg.history || msg.data || []);
        break;
      }

      // Mod list responses
      case 'mod_list':
      case 'moderators':
      case 'room_mods':
      case 'mods': {
        const room = msg._batchRoom || msg.room || this._cc._getPrimaryRoom();
        if (room) this._modReplies.set(room, msg.mods || msg.moderators || msg.users || []);
        break;
      }

      // Ban list responses
      case 'ban_list':
      case 'banned_users':
      case 'bans': {
        const room = msg._batchRoom || msg.room || this._cc._getPrimaryRoom();
        if (room) this._banReplies.set(room, msg.bans || msg.users || msg.banned || []);
        break;
      }

      default: {
        // Capture anything else that comes back after our probes
        if (!['pong','ping','batch','welcome','room_list_batch','social_sync',
              'friend_status_update','update_room_limits','youtube_queue_updated',
              'live_log_push','login_success','chat_message','message','room_message',
              'user_join','user_joined','user_leave','user_left','user_list',
              'room_users','join_room_success','joined_room','room_joined',
              'friend_request','private_message','notification',
              'webrtc_offer','webrtc_answer','ice_candidate',
              'user_style_update','room_automation_sync','network_news_data',
              'room_visual_update','broadcast_stopped','forum_structure_changed',
            ].includes(t)) {
          this._unknownReplies.push({ type: t, data: msg, ts: Date.now() });
          if (this._unknownReplies.length > 80) this._unknownReplies.shift();
        }
        break;
      }
    }
  }

  // ── Active WS probes ──────────────────────────────────────────────────────────

  _wsProbe() {
    const cc = this._cc;
    if (!cc.isConnected) return;

    // Room list (multiple variant names)
    for (const t of ['get_rooms','room_list','get_room_list','rooms','all_rooms']) {
      cc._send({ type: t });
    }

    // Online users / global
    for (const t of ['get_online_users','online_users','get_all_users','user_count']) {
      cc._send({ type: t });
    }

    // Friends
    for (const t of ['get_friends','friends_list','get_social']) {
      cc._send({ type: t });
    }

    // Admin probes
    for (const t of WS_ADMIN_TYPES) {
      cc._send({ type: t });
    }

    // Per-room probes
    for (const room of cc._joinedRooms) {
      // User list
      cc._send({ type: 'get_users',   room });
      cc._send({ type: 'room_users',  room });
      cc._send({ type: 'user_list',   room });

      // History
      for (const t of WS_ROOM_HISTORY_TYPES) {
        cc._send({ type: t, room, limit: 50 });
      }

      // Mods
      for (const t of WS_MOD_TYPES) {
        cc._send({ type: t, room });
      }

      // Bans
      for (const t of WS_BAN_TYPES) {
        cc._send({ type: t, room });
      }

      // Room detail
      for (const t of WS_ROOM_DETAIL_TYPES) {
        cc._send({ type: t, room });
      }
    }

    // Profile probes for users we know about
    const probed = new Set();
    for (const users of this._userLists.values()) {
      for (const u of users) {
        if (probed.has(u.handle)) continue;
        probed.add(u.handle);
        for (const t of WS_USER_PROFILE_TYPES) {
          cc._send({ type: t, username: u.nick, userId: u.handle });
        }
      }
    }

    // Search probes
    for (const t of WS_SEARCH_TYPES) {
      cc._send({ type: t, query: '', limit: 100 });
    }
  }

  // ── HTTP probe — scan chatcommon.com REST API ─────────────────────────────────

  async _httpProbe(sessionCookie) {
    const BASE    = 'https://chatcommon.com';
    const results = [];
    const headers = sessionCookie ? { Cookie: sessionCookie } : {};

    this.log?.info('[MaraSniff] starting HTTP probe...');

    await Promise.all(HTTP_PROBES.map(async (path) => {
      const url = BASE + path;
      const res = await httpGet(url, headers, 6000);
      if (!res) return;

      let parsed = null;
      try { parsed = JSON.parse(res.body); } catch { /* not JSON */ }

      if (res.status < 400 || (parsed && res.status < 500)) {
        const preview = parsed
          ? JSON.stringify(parsed).slice(0, 200)
          : res.body.replace(/\s+/g, ' ').slice(0, 150);
        results.push({ path, status: res.status, preview, parsed });
        this.log?.info(`[MaraSniff] HTTP ${res.status} ${path}`);
      }
    }));

    this._httpResults = results;
    return results;
  }

  // ── Build full report ─────────────────────────────────────────────────────────

  async buildReport(requestedBy) {
    this.log?.info('[MaraSniff] probing...');

    // Fire WS probes + HTTP probes in parallel, wait 5s for responses
    const httpPromise = this._httpProbe();
    this._wsProbe();
    await new Promise(r => setTimeout(r, 5000));
    await httpPromise;

    const lines = [];
    const ts    = new Date().toUTCString();

    lines.push(`=== MARA SNIFF REPORT ===`);
    lines.push(`req: ${requestedBy}  |  ${ts}`);
    lines.push('');

    // ── Site totals ───────────────────────────────────────────────────────────────
    if (Object.keys(this._siteTotals).length) {
      lines.push(`── SITE TOTALS ──`);
      for (const [k, v] of Object.entries(this._siteTotals)) {
        lines.push(`  ${k}: ${v}`);
      }
      lines.push('');
    }

    // ── Global broadcasters ───────────────────────────────────────────────────────
    if (this._globalBroadcast.length) {
      lines.push(`── GLOBAL BROADCASTERS (${this._globalBroadcast.length}) ──`);
      for (const b of this._globalBroadcast.slice(0, 10)) {
        const nick = b.username || b.nick || String(b);
        const room = b.room || '';
        lines.push(`  ${nick}${room ? '  room:'+room : ''}`);
      }
      lines.push('');
    }

    // ── Rooms ─────────────────────────────────────────────────────────────────────
    if (this._rooms.size) {
      lines.push(`── ROOMS (${this._rooms.size}) ──`);
      const sorted = [...this._rooms.values()].sort((a, b) => {
        const ac = typeof a.userCount === 'number' ? a.userCount : 0;
        const bc = typeof b.userCount === 'number' ? b.userCount : 0;
        return bc - ac;
      });
      for (const r of sorted) {
        const flags = [
          r.locked ? 'locked' : '',
          r.nsfw   ? 'nsfw'   : '',
          r.owner  ? `owner:${r.owner}` : '',
        ].filter(Boolean).join(' ');
        lines.push(`  ${r.name}  users:${r.userCount} cams:${r.camCount} ${flags}`);
        if (r.description) lines.push(`    desc: "${r.description.slice(0, 80)}"`);
        if (r.topic)       lines.push(`    topic: "${r.topic.slice(0, 80)}"`);
      }
      lines.push('');
    }

    // ── Users in joined rooms ─────────────────────────────────────────────────────
    if (this._userLists.size) {
      lines.push(`── USERS IN JOINED ROOMS ──`);
      for (const [room, users] of this._userLists.entries()) {
        lines.push(`  ${room} (${users.length}):`);
        for (const u of users) {
          lines.push(`    ${u.nick}${u.mod ? ' [mod]' : ''}  id:${u.handle}`);
        }
      }
      lines.push('');
    }

    // ── User profiles (from probe responses) ──────────────────────────────────────
    if (this._profileReplies.size) {
      lines.push(`── USER PROFILES (${this._profileReplies.size}) ──`);
      for (const [handle, p] of this._profileReplies.entries()) {
        const nick  = p.username || p.nick || handle;
        const email = p.email || p.emailAddress || '';
        const role  = p.role  || p.userType || '';
        const bio   = p.bio   || p.description || '';
        const reg   = p.createdAt || p.registeredAt || p.joinDate || '';
        lines.push(`  ${nick}  id:${handle}${role ? ' role:'+role : ''}${email ? ' email:'+email : ''}`);
        if (bio) lines.push(`    bio: "${bio.slice(0, 80)}"`);
        if (reg) lines.push(`    registered: ${reg}`);
      }
      lines.push('');
    }

    // ── Room config ───────────────────────────────────────────────────────────────
    if (this._roomLimits.size) {
      lines.push(`── ROOM CONFIG ──`);
      for (const [room, lim] of this._roomLimits.entries()) {
        lines.push(`  ${room}:`);
        const skip = new Set(['type','_batchRoom','room','roomName']);
        for (const [k, v] of Object.entries(lim)) {
          if (skip.has(k)) continue;
          if (v == null || v === '' || v === false) continue;
          lines.push(`    ${k}: ${String(v).slice(0, 100)}`);
        }
      }
      lines.push('');
    }

    // ── Message history ───────────────────────────────────────────────────────────
    if (this._historyReplies.size) {
      lines.push(`── MESSAGE HISTORY ──`);
      for (const [room, msgs] of this._historyReplies.entries()) {
        lines.push(`  ${room} (${msgs.length} msgs):`);
        for (const m of (Array.isArray(msgs) ? msgs : []).slice(-10)) {
          const nick = m.username || m.nick || m.from || '?';
          const text = m.message  || m.text || m.content || '';
          const time = m.createdAt || m.timestamp || m.ts || '';
          lines.push(`    [${time ? new Date(time).toISOString().slice(11,19) : '?'}] ${nick}: ${text.slice(0, 100)}`);
        }
      }
      lines.push('');
    }

    // ── Mod lists ─────────────────────────────────────────────────────────────────
    if (this._modReplies.size) {
      lines.push(`── MOD LISTS ──`);
      for (const [room, mods] of this._modReplies.entries()) {
        const list = Array.isArray(mods) ? mods.map(m => m.username || m.nick || String(m)).join(', ') : String(mods);
        lines.push(`  ${room}: ${list}`);
      }
      lines.push('');
    }

    // ── Ban lists ─────────────────────────────────────────────────────────────────
    if (this._banReplies.size) {
      lines.push(`── BAN LISTS ──`);
      for (const [room, bans] of this._banReplies.entries()) {
        lines.push(`  ${room} (${Array.isArray(bans) ? bans.length : '?'} bans):`);
        for (const b of (Array.isArray(bans) ? bans.slice(0, 20) : [])) {
          const nick   = b.username || b.nick || String(b);
          const reason = b.reason   || '';
          lines.push(`    ${nick}${reason ? ' reason:'+reason : ''}`);
        }
      }
      lines.push('');
    }

    // ── Social / friends ──────────────────────────────────────────────────────────
    if (this._socialSync) {
      const ss = this._socialSync;
      lines.push(`── SOCIAL ──`);
      lines.push(`  total friends: ${ss.friends.length}`);
      if (ss.onlineFriends.length) {
        lines.push(`  online (${ss.onlineFriends.length}):`);
        for (const f of ss.onlineFriends.slice(0, 30)) {
          const nick = f.username || f.nick || f.name || String(f);
          const room = f.room || f.room_display || '';
          const mood = f.mood || f.status_message || '';
          lines.push(`    ${nick}${room ? ' in:'+room : ''}${mood ? ' mood:'+mood : ''}`);
        }
      }
      if (ss.requests.length) lines.push(`  pending requests: ${ss.requests.length}`);
      lines.push('');
    }

    // ── Friend status detail ──────────────────────────────────────────────────────
    if (this._friendStatus.size) {
      lines.push(`── FRIEND STATUS DETAIL (${this._friendStatus.size}) ──`);
      for (const [nick, s] of this._friendStatus.entries()) {
        const room    = s.room || s.room_display || s.watching_title || '';
        const mood    = s.mood || s.status_message || '';
        const idle    = s.idle_since ? `idle:${s.idle_since}` : '';
        const lastSeen = s.last_seen || '';
        lines.push(`  ${nick}  status:${s.status||'?'}${room?' in:'+room:''}${mood?' mood:'+mood:''}${idle?' '+idle:''}${lastSeen?' last:'+lastSeen:''}`);
      }
      lines.push('');
    }

    // ── Room automation (auto-responders, custom emojis, soundboard) ─────────────
    if (this._roomAutomation.size) {
      lines.push(`── ROOM AUTOMATION ──`);
      for (const [room, a] of this._roomAutomation.entries()) {
        lines.push(`  ${room}:`);
        if (a.autoResponders?.length) {
          lines.push(`    autoResponders (${a.autoResponders.length}):`);
          for (const r of a.autoResponders.slice(0, 10)) {
            const trigger  = r.trigger  || r.keyword || r.pattern || JSON.stringify(r).slice(0, 60);
            const response = r.response || r.reply   || r.text    || '';
            lines.push(`      "${trigger}" → "${String(response).slice(0, 80)}"`);
          }
        }
        if (a.customEmojis?.length) {
          lines.push(`    customEmojis (${a.customEmojis.length}): ${a.customEmojis.slice(0, 15).map(e => e.name || e.code || String(e)).join(', ')}`);
        }
        if (a.soundboard?.length) {
          lines.push(`    soundboard (${a.soundboard.length}): ${a.soundboard.slice(0, 10).map(s => s.name || s.title || String(s)).join(', ')}`);
        }
      }
      lines.push('');
    }

    // ── Network news ──────────────────────────────────────────────────────────────
    if (this._networkNews.length) {
      lines.push(`── NETWORK NEWS (${this._networkNews.length}) ──`);
      for (const e of this._networkNews.slice(0, 10)) {
        const text = typeof e === 'string' ? e
          : (e.title || e.message || e.text || e.content || JSON.stringify(e).slice(0, 150));
        lines.push(`  ${text}`);
      }
      lines.push('');
    }

    // ── Seen users (enumerated from style updates) ────────────────────────────────
    if (this._seenUsers.size) {
      lines.push(`── SEEN USERS (${this._seenUsers.size} unique accounts) ──`);
      const sorted = [...this._seenUsers.entries()].sort((a, b) => b[1].seenAt - a[1].seenAt);
      for (const [uname, u] of sorted.slice(0, 50)) {
        const idle = u.idle_since ? `  idle:${u.idle_since}` : '';
        const st   = u.status_type ? `  [${u.status_type}]` : '';
        lines.push(`  ${uname}  nick:"${u.nick}"${st}${idle}`);
      }
      if (this._seenUsers.size > 50) lines.push(`  ... and ${this._seenUsers.size - 50} more`);
      lines.push('');
    }

    // ── YouTube queues ────────────────────────────────────────────────────────────
    if (this._ytQueues.size) {
      lines.push(`── YOUTUBE QUEUES ──`);
      for (const [room, yt] of this._ytQueues.entries()) {
        lines.push(`  ${room}:`);
        if (yt.current) {
          const c = yt.current;
          lines.push(`    NOW: ${c.title || c.videoId || JSON.stringify(c).slice(0,80)}`);
        }
        if (Array.isArray(yt.queue)) {
          for (const q of yt.queue.slice(0, 5)) {
            lines.push(`    QUEUE: ${q.title || q.videoId || String(q)}`);
          }
        }
      }
      lines.push('');
    }

    // ── Live log tail ─────────────────────────────────────────────────────────────
    if (this._liveLog.length) {
      lines.push(`── LIVE LOG (last ${Math.min(this._liveLog.length, 15)}) ──`);
      for (const e of this._liveLog.slice(-15)) {
        const entry = e.entry;
        const text  = typeof entry === 'string' ? entry
          : (entry?.message || entry?.text || entry?.action || JSON.stringify(entry).slice(0, 120));
        lines.push(`  [${e.room||'?'}] ${text}`);
      }
      lines.push('');
    }

    // ── Unknown WS reply types (from probes) ──────────────────────────────────────
    const recentUnknown = this._unknownReplies.filter(r => Date.now() - r.ts < 10000);
    if (recentUnknown.length) {
      lines.push(`── NEW WS RESPONSE TYPES (${recentUnknown.length}) ──`);
      const seen = new Set();
      for (const r of recentUnknown) {
        if (seen.has(r.type)) continue;
        seen.add(r.type);
        const preview = JSON.stringify(r.data).slice(0, 150);
        lines.push(`  type:${r.type}  ${preview}`);
      }
      lines.push('');
    }

    // ── HTTP results ──────────────────────────────────────────────────────────────
    if (this._httpResults.length) {
      lines.push(`── HTTP API HITS (${this._httpResults.length}/${HTTP_PROBES.length} paths) ──`);
      for (const r of this._httpResults) {
        lines.push(`  [${r.status}] ${r.path}`);
        if (r.preview) lines.push(`    ${r.preview}`);
      }
      lines.push('');
    } else {
      lines.push(`── HTTP API — no open endpoints found (${HTTP_PROBES.length} paths tried) ──`);
      lines.push('');
    }

    lines.push(`=== END REPORT ===`);
    return lines.join('\n');
  }

  // ── Resolve a display nick to account username using social data ─────────────

  _resolveHandle(nick) {
    const lower = nick.toLowerCase();
    // Check friend status map (keyed by account username)
    for (const [uname, s] of this._friendStatus.entries()) {
      const n = (s.nickname || s.nick || '').toLowerCase();
      if (n === lower || uname.toLowerCase() === lower) return uname;
    }
    // Check seen users
    for (const [uname, u] of this._seenUsers.entries()) {
      if ((u.nick || '').toLowerCase() === lower || uname.toLowerCase() === lower) return uname;
    }
    // Check socialSync friendData
    const fd = this._socialSync?.friendData;
    if (fd && typeof fd === 'object') {
      for (const val of Object.values(fd)) {
        if (!val?.username) continue;
        const n = (val.nickname || val.nick || val.username).toLowerCase();
        if (n === lower || val.username.toLowerCase() === lower) return val.username;
      }
    }
    return nick;  // fallback to what was given
  }

  // ── Send report via PM ────────────────────────────────────────────────────────

  async sendReport(requestedByNick, requestedByHandle, extraRecipients = []) {
    const report = await this.buildReport(requestedByNick);
    const CHUNK  = 400;
    const chunks = [];
    for (let i = 0; i < report.length; i += CHUNK) chunks.push(report.slice(i, i + CHUNK));

    const cc = this._cc;
    const sendTo = (nick, handle) => {
      for (let i = 0; i < chunks.length; i++) {
        const prefix = chunks.length > 1 ? `[${i+1}/${chunks.length}] ` : '';
        setTimeout(() => cc.sendPrivateMessage(nick, handle || nick, prefix + chunks[i]), i * 600);
      }
    };

    sendTo(requestedByNick, requestedByHandle);
    for (const { nick, handle } of extraRecipients) {
      const resolvedHandle = handle !== nick ? handle : this._resolveHandle(nick);
      sendTo(nick, resolvedHandle);
    }

    this.log?.info(`[MaraSniff] report → ${requestedByNick} + ${extraRecipients.map(r=>r.nick).join(', ')} (${chunks.length} chunks)`);
  }
}

module.exports = MaraSniff;
