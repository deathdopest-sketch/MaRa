'use strict';

const WebSocket = require('ws');
const crypto    = require('crypto');
const https     = require('https');

let _socksAgent = null;
const _ccProxy = process.env.CHATCOMMON_SOCKS_PROXY || process.env.SPACKLE_SOCKS_PROXY;
if (_ccProxy) {
  const { SocksProxyAgent } = require('socks-proxy-agent');
  _socksAgent = new SocksProxyAgent(_ccProxy);
}

/**
 * ChatCommonClient — plain WebSocket client for chatcommon.com
 *
 * Protocol: single WS to wss://ws.chatcommon.com/
 *   1. Open connection
 *   2. → {type:"client_identify", fingerprint}
 *   3. → {type:"login", username, password, is_logged_in:true, stealth:false, fingerprint}
 *   4. ← {type:"welcome", clientId, config}
 *   5. ← {type:"login_success", role, profile}
 *   6. → {type:"join_room", room:"<name>"}   (for each room)
 *   7. Heartbeat: → {type:"ping", timestamp, room} every 1s
 *              and ← server sends {type:"ping"} which we respond to
 *
 * NOTE: Room join success type ("room_joined" vs "join_room_success") and exact
 * chat/presence event shapes are confirmed by tools/sniff-chatcommon.js with credentials.
 * Handles are matched against multiple candidate field names.
 *
 * Callbacks (same interface as MumbleChatClient):
 *   onMessage(roomName, nick, text, handle)
 *   onJoin(roomName, nick, handle, username, mod, meta)
 *   onJoined(roomName, nick, handle, username)
 *   onLeave(roomName, nick, handle)
 *   onNickChange(roomName, oldNick, newNick, handle)
 *   onUserList(roomName, users[])
 *   onClosed(roomName)
 *   onReconnected(roomName)
 *   onPrivateMessage(fromNick, fromHandle, text)   — incoming DM/PM
 *   onFriendRequest(fromNick, fromHandle, requestId) — incoming friend request
 *   onNotification(type, data)                     — any other notification
 */
class ChatCommonClient {
  constructor(username, password, logger) {
    this._username    = username;
    this._password    = password;
    this._fingerprint = crypto.createHash('sha256')
      .update('spackle-cc:' + username).digest('hex');
    this.log          = logger;

    this._ws               = null;
    this._active           = false;
    this._authed           = false;
    this._rooms            = new Set();
    this._joinedRooms      = new Set();
    this._nickMap          = new Map();
    this._pingInterval     = null;
    this._reconnectTimer   = null;
    this._reconnectAttempts = 0;
    this._reconnectDelay   = 2000;

    this.cb = {};
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect() {
    if (this._ws?.readyState === WebSocket.OPEN) return;

    this.log?.info('[ChatCommon] Connecting to wss://ws.chatcommon.com/');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('[ChatCommon] Connection timeout after 20s')), 20000
      );

      const ws = new WebSocket('wss://ws.chatcommon.com/', {
        headers: {
          'Origin'    : 'https://chatcommon.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        ...(_socksAgent ? { agent: _socksAgent } : {}),
      });

      ws.once('open', () => {
        clearTimeout(timeout);
        this._ws     = ws;
        this._active = true;
        // Only reset backoff once fully authenticated (in login_success handler)
        this._bindWsEvents();
        this._doAuth();
        resolve();
      });

      ws.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async disconnect() {
    this._active = false;
    this._stopPing();
    clearTimeout(this._reconnectTimer);
    if (this._ws) {
      try { this._ws.terminate(); } catch (_) {}
      this._ws = null;
    }
    this._rooms.clear();
    this._joinedRooms.clear();
    this._authed = false;
    this.log?.info('[ChatCommon] Disconnected');
  }

  get isConnected() {
    return this._ws?.readyState === WebSocket.OPEN && this._authed;
  }

  // ── Room operations ────────────────────────────────────────────────────────

  joinRoom(roomName, password) {
    this._rooms.add(roomName);
    if (password) this._roomPasswords = { ...(this._roomPasswords || {}), [roomName]: password };
    if (this._authed) this._sendJoinRoom(roomName);
  }

  _sendJoinRoom(roomName) {
    this._lastJoiningRoom = roomName;
    const pw = this._roomPasswords?.[roomName];
    this._send({ type: 'join_room', room: roomName, username: this._myUsername || this._username, nickname: null, ...(pw ? { password: pw } : {}) });
    this.log?.info(`[ChatCommon] join_room: ${roomName}`);
  }

  leaveRoom(roomName) {
    this._rooms.delete(roomName);
    this._joinedRooms.delete(roomName);
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._send({ type: 'leave_room', room: roomName });
    }
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  sendPrivateMessage(toNick, toHandle, text) {
    if (!this.isConnected) return false;
    const mid = 'pm-' + Math.random().toString(36).slice(2, 12);
    const ts  = Date.now();
    // Send all known field-name variants — server accepts whichever it recognises
    this._send({ type: 'private_message',      to: toNick, toUserId: toHandle, recipient: toHandle || toNick, message: text, message_id: mid, timestamp: ts });
    this._send({ type: 'send_private_message', username: toNick, userId: toHandle,                             message: text, message_id: mid, timestamp: ts });
    return true;
  }

  send(roomName, text) {
    if (!this.isConnected) {
      this.log?.warn(`[ChatCommon:${roomName}] send() — not authed, dropping: ${String(text).slice(0, 60)}`);
      return false;
    }
    this._send({ type: 'send_message', room: roomName, message: text });
    return true;
  }

  // ── Internal auth + ping ───────────────────────────────────────────────────

  _httpLogin() {
    return new Promise((resolve, reject) => {
      // Step 1: GET the homepage to pick up any initial cookies (CSRF/CF)
      const getReq = https.request({
        hostname: 'chatcommon.com',
        path    : '/',
        method  : 'GET',
        headers : {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept'    : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      }, (res) => {
        const initCookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          // Extract CSRF token if present (common field names)
          const csrfMatch = body.match(/name="csrf[_-]?token"[^>]*value="([^"]+)"/i)
                         || body.match(/name="_token"[^>]*value="([^"]+)"/i)
                         || body.match(/"csrfToken"\s*:\s*"([^"]+)"/i);
          const csrf = csrfMatch ? csrfMatch[1] : '';

          // Step 2: POST login
          const payload = JSON.stringify({
            username: this._username,
            password: this._password,
            ...(csrf ? { csrf_token: csrf, _token: csrf } : {}),
          });

          const postReq = https.request({
            hostname: 'chatcommon.com',
            path    : '/login',
            method  : 'POST',
            headers : {
              'Content-Type' : 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'User-Agent'   : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Origin'       : 'https://chatcommon.com',
              'Referer'      : 'https://chatcommon.com/',
              'Accept'       : 'application/json, text/plain, */*',
              ...(initCookies ? { 'Cookie': initCookies } : {}),
            },
          }, (pres) => {
            const loginCookies = (pres.headers['set-cookie'] || []).map(c => c.split(';')[0]);
            let pbody = '';
            pres.on('data', d => { pbody += d; });
            pres.on('end', () => {
              const allCookies = [
                ...initCookies.split('; ').filter(Boolean),
                ...loginCookies,
              ].filter(Boolean).join('; ');

              this.log?.info(`[ChatCommon] HTTP login — status: ${pres.statusCode}, cookies: ${allCookies.length > 0 ? 'yes' : 'none'}, body: ${pbody.slice(0, 120)}`);

              if (allCookies) this._sessionCookie = allCookies;
              // Resolve whether or not login succeeded — WS will surface the real result
              resolve(allCookies);
            });
          });

          postReq.on('error', reject);
          postReq.write(payload);
          postReq.end();
        });
      });

      getReq.on('error', reject);
      getReq.end();
    });
  }

  _doAuth() {
    this._send({ type: 'client_identify', fingerprint: this._fingerprint });
    // If we already have a session token from a previous connection, go straight to
    // the upgraded auth. Otherwise do the first-step credential login.
    if (this._sessionToken) {
      this._authUpgraded = true;
      this._send({
        type        : 'login',
        username    : this._username,
        session_token: this._sessionToken,
        is_logged_in: true,
        fingerprint : this._fingerprint,
      });
    } else {
      this._authUpgraded = false;
      this._send({
        type       : 'login',
        username   : this._username,
        password   : this._password,
        stealth    : false,
        fingerprint: this._fingerprint,
      });
    }
    this._lastJoiningRoom = null;
  }

  _startPing() {
    this._stopPing();
    this._pingInterval = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._send({
          type     : 'ping',
          timestamp: Date.now(),
          room     : this._getPrimaryRoom() || 'Lobby',
        });
      }
    }, 1000);
  }

  _stopPing() {
    clearInterval(this._pingInterval);
    this._pingInterval = null;
  }

  _send(obj) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    try { this._ws.send(JSON.stringify(obj)); } catch (_) {}
  }

  _scheduleReconnect() {
    if (!this._active) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectAttempts++;
    const base  = this._reconnectDelay;
    const delay = Math.min(base * Math.pow(1.5, Math.min(this._reconnectAttempts - 1, 8)), 60000);
    this.log?.info(`[ChatCommon] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._reconnectAttempts})`);
    this._reconnectTimer = setTimeout(async () => {
      if (!this._active) return;
      try {
        await this.connect();
      } catch (err) {
        this.log?.error('[ChatCommon] Reconnect failed: ' + err.message);
        this._scheduleReconnect();
      }
    }, delay);
  }

  // ── Event dispatch ─────────────────────────────────────────────────────────

  _bindWsEvents() {
    const ws = this._ws;

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (_) { return; }
      this._dispatch(msg);
    });

    ws.on('close', (code) => {
      this.log?.warn(`[ChatCommon] WS closed (${code})`);
      this._authed       = false;
      this._authUpgraded = false;
      this._stopPing();
      this._joinedRooms.clear();
      // Session tokens expire on disconnect — clear so we redo the full two-step auth
      if (code !== 1000) this._sessionToken = null;
      if (this._active) {
        for (const r of this._rooms) this.cb.onClosed?.(r);
        // Code 1000 = server-intentional close (rate-limit, kick, etc.) — back off longer.
        if (code === 1000) this._reconnectDelay = Math.max(this._reconnectDelay, 30_000);
        this._scheduleReconnect();
      }
    });

    ws.on('error', (err) => {
      this.log?.error('[ChatCommon] WS error: ' + err.message);
    });
  }

  _dispatch(msg) {
    switch (msg.type) {

      case 'welcome':
        this.log?.info(`[ChatCommon] Welcome — clientId: ${msg.clientId}`);
        break;

      case 'login_success': {
        const token = msg.session_token || null;
        const role  = msg.role || '';
        const uname = msg.profile?.username || this._username;

        // Two-step auth: if we got a session token but are still Guest,
        // immediately re-auth with the token + is_logged_in:true to upgrade role.
        if (token && role === 'Guest' && !this._authUpgraded) {
          this._authUpgraded = true;
          this._sessionToken = token;
          this._myUsername   = uname;
          this.log?.info(`[ChatCommon] Got session token — upgrading auth...`);
          this._send({
            type        : 'login',
            username    : this._username,
            session_token: token,
            is_logged_in: true,
            fingerprint : this._fingerprint,
          });
          break;
        }

        this._authUpgraded  = false;
        this._authed        = true;
        this._myUsername    = uname;
        this._sessionToken  = token || this._sessionToken;
        this._myRole        = role;
        this._reconnectDelay    = 2000;
        this._reconnectAttempts = 0;
        this.log?.info(`[ChatCommon] Login success — role: ${role}, user: ${this._myUsername}`);
        this._startPing();
        for (const roomName of this._rooms) this._sendJoinRoom(roomName);
        break;
      }

      case 'login_error':
      case 'auth_error':
      case 'login_failed':
        this.log?.error(`[ChatCommon] Login error (${msg.type}): ${msg.reason || msg.message || JSON.stringify(msg)}`);
        break;

      case 'pong':
        break;

      case 'ping':
        this._send({ type: 'pong', timestamp: msg.timestamp });
        break;

      // Batch — chat and presence events are wrapped here when in a room
      case 'batch': {
        const batchRoom = msg.room || msg.roomName;
        for (const ev of (msg.events || [])) {
          if (batchRoom) ev._batchRoom = batchRoom;
          // Temporary: log all inner batch event types so we can see what comes in
          this.log?.debug?.(`[ChatCommon] batch inner: type=${ev.type} room=${batchRoom} keys=${Object.keys(ev).join(',')}`);
          this._dispatch(ev);
        }
        break;
      }

      // Room join success — sniff confirmed type is "join_room_success"
      case 'room_joined':
      case 'join_room_success':
      case 'joined_room': {
        const roomName = msg.room || msg.roomName || msg.name;
        if (!roomName) break;
        const wasJoined = this._joinedRooms.has(roomName);
        this._joinedRooms.add(roomName);
        this._lastJoiningRoom = null;
        this.log?.info(`[ChatCommon] Joined room: ${roomName}`);
        if (wasJoined) {
          this.cb.onReconnected?.(roomName);
        } else {
          this.cb.onJoined?.(roomName, this._myUsername || this._username, null, this._myUsername || this._username);
        }
        // join_room_success includes an initial user roster
        if (Array.isArray(msg.users) && msg.users.length) {
          const users = msg.users.map(u => ({
            nick    : u.username || u.nickname || u.nick || '',
            handle  : String(u.id || u.userId || u.username || ''),
            username: u.username || '',
            mod     : (u.role === 'mod' || u.role === 'owner') ? 1 : 0,
          })).filter(u => u.nick);
          for (const u of users) this._setNick(roomName, u.nick, u.handle);
          this.cb.onUserList?.(roomName, users);
        }
        break;
      }

      // Incoming chat — handle multiple possible type names
      case 'chat_message':
      case 'message':
      case 'room_message': {
        const roomName = msg._batchRoom || msg.room || msg.roomName || this._getPrimaryRoom();
        if (!roomName) break;
        const nick = msg.username || msg.nick || msg.sender?.username || msg.user?.username;
        if (!nick) break;
        const text   = msg.message || msg.content || msg.text || '';
        const myU = (this._myUsername || this._username).toLowerCase();
        if (nick.toLowerCase() === myU && !text.startsWith('.')) break;
        const handle = String(msg.userId || msg.user_id || msg.sender?.id || msg.user?.id || nick);
        this._setNick(roomName, nick, handle);
        this.cb.onMessage?.(roomName, nick, text, handle);
        break;
      }

      // User joined a room
      case 'user_join':
      case 'user_joined':
      case 'room_user_joined': {
        const roomName = msg._batchRoom || msg.room || msg.roomName || this._getPrimaryRoom();
        if (!roomName) break;
        const nick   = msg.username || msg.nick || msg.user?.username;
        if (!nick) break;
        const handle = String(msg.userId || msg.user_id || msg.user?.id || nick);
        this._setNick(roomName, nick, handle);
        this.cb.onJoin?.(roomName, nick, handle, nick, 0, { guest: msg.role === 'Guest' });
        break;
      }

      // User left a room
      case 'user_leave':
      case 'user_left':
      case 'room_user_left': {
        const roomName = msg._batchRoom || msg.room || msg.roomName || this._getPrimaryRoom();
        if (!roomName) break;
        const nick   = msg.username || msg.nick || msg.user?.username || null;
        const handle = String(msg.userId || msg.user_id || msg.user?.id || nick || '');
        this.cb.onLeave?.(roomName, nick, handle);
        break;
      }

      // user_list is global (no room field) — use lastJoining room or skip
      case 'user_list':
      case 'room_users': {
        const roomName = msg._batchRoom || msg.room || msg.roomName || this._lastJoiningRoom || null;
        if (!roomName) break;
        const users = (msg.users || []).map(u => ({
          nick    : u.username || u.nick || '',
          handle  : String(u.id || u.userId || u.username || ''),
          username: u.username || '',
          mod     : (u.role === 'mod' || u.role === 'owner') ? 1 : 0,
        })).filter(u => u.nick);
        for (const u of users) this._setNick(roomName, u.nick, u.handle);
        this.cb.onUserList?.(roomName, users);
        break;
      }

      case 'nick_change': {
        const roomName = msg.room || msg.roomName || this._getPrimaryRoom();
        if (!roomName) break;
        this.cb.onNickChange?.(roomName, msg.oldNick, msg.newNick, msg.handle || '');
        break;
      }

      // ── Friend requests ──────────────────────────────────────────────────────
      case 'friend_request':
      case 'friend_invite':
      case 'friend_request_received':
      case 'incoming_friend_request': {
        const fromNick   = msg.username || msg.nick || msg.fromUsername || msg.from_username || msg.sender?.username || '';
        const fromHandle = String(msg.userId || msg.user_id || msg.fromUserId || msg.sender?.id || fromNick);
        const requestId  = msg.requestId || msg.request_id || msg.id || '';
        this.log?.info(`[ChatCommon] Friend request from: ${fromNick}`);
        // Auto-accept — send all plausible acceptance message shapes
        this._send({ type: 'accept_friend_request', requestId, userId: fromHandle });
        this._send({ type: 'friend_request_accept', requestId, userId: fromHandle });
        this._send({ type: 'accept_friend',          requestId, userId: fromHandle });
        this.cb.onFriendRequest?.(fromNick, fromHandle, requestId);
        break;
      }

      // ── Private messages ─────────────────────────────────────────────────────
      case 'private_message':
      case 'direct_message':
      case 'pm':
      case 'dm':
      case 'whisper': {
        // sender can be a plain string (username) or an object
        const senderRaw  = msg.sender;
        const fromNick   = msg.username || msg.nick || msg.fromUsername
                        || (typeof senderRaw === 'string' ? senderRaw : senderRaw?.username)
                        || '';
        if (!fromNick) break;
        // skip echo of our own PMs
        if (fromNick.toLowerCase() === (this._myUsername || this._username || '').toLowerCase()) break;
        const fromHandle = String(msg.userId || msg.user_id
                        || (typeof senderRaw === 'object' ? senderRaw?.id : null)
                        || fromNick);
        const text       = msg.message || msg.content || msg.text || '';
        this.log?.info(`[ChatCommon] PM from ${fromNick}: ${text.slice(0, 80)}`);
        this.cb.onPrivateMessage?.(fromNick, fromHandle, text);
        break;
      }

      // ── General notifications (sub-typed) ────────────────────────────────────
      case 'notification': {
        const subType = msg.subType || msg.notification_type || msg.kind || '';
        this.log?.info(`[ChatCommon] Notification subtype=${subType} keys=${Object.keys(msg).join(',')}`);
        // Re-route friend-request notifications
        if (/friend/i.test(subType)) {
          this._dispatch({ ...msg, type: 'friend_request' });
          break;
        }
        if (/private|dm|pm|whisper/i.test(subType)) {
          this._dispatch({ ...msg, type: 'private_message' });
          break;
        }
        this.cb.onNotification?.(subType, msg);
        break;
      }

      // ── WebRTC signaling — log so we can reverse-engineer the protocol ────────
      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'ice_candidate':
      case 'sdp_offer':
      case 'sdp_answer':
      case 'stream_offer':
      case 'start_stream':
      case 'start_camera':
      case 'camera_offer':
      case 'rtc_offer': {
        this.log?.info(`[ChatCommon] WebRTC msg type=${msg.type} keys=${Object.keys(msg).join(',')}`);
        this.cb.onRtcSignal?.(msg);
        break;
      }

      case 'join_room_failed':
        this.log?.warn(`[ChatCommon] join_room_failed — room: ${msg.room || '?'}, reason: ${msg.reason || JSON.stringify(msg)}`);
        break;

      // banned — server evicting us (room ban or session ban)
      case 'banned': {
        const reason = msg.reason || msg.message || '';
        const room   = msg.room || msg.roomName || null;
        this.log?.warn(`[ChatCommon] BANNED${room ? ' from ' + room : ''} — reason: ${reason || '(no reason given)'}`);
        if (room) {
          this._joinedRooms.delete(room);
          this._rooms.delete(room);
        } else {
          // Session-level ban — clear token so reconnect starts fresh
          this._sessionToken = null;
        }
        break;
      }

      // youtube_queue_updated — confirmed real event name for YouTube queue state
      case 'youtube_queue_updated':
        this.log?.debug(`[ChatCommon] youtube_queue_updated room=${msg.room} playing=${msg.currentlyPlaying?.title || 'none'}`);
        break;

      // suppress noisy but harmless room-meta/presence events at debug level
      case 'update_room_limits':
      case 'room_list_batch':
      case 'social_sync':
      case 'forum_structure_changed':
      case 'user_style_update':
      case 'friend_typing':
        this.log?.debug?.(`[ChatCommon] ${msg.type}`);
        break;

      // live_log_push is how ChatCommon delivers room chat messages
      case 'live_log_push': {
        const entry    = msg.entry || msg;
        const roomName = msg._batchRoom || entry.room || entry.roomName || this._getPrimaryRoom();
        if (!roomName) break;
        const nick   = entry.user || entry.username || entry.raw_sender || entry.nick || '';
        if (!nick) break;
        const text   = entry.msg || entry.message || entry.content || '';
        const handle = String(entry.userId || entry.user_id || entry.raw_sender || nick);
        const myU    = (this._myUsername || this._username || '').toLowerCase();
        if (nick.toLowerCase() === myU && !text.startsWith('.')) break;
        this._setNick(roomName, nick, handle);
        this.cb.onMessage?.(roomName, nick, text, handle);
        break;
      }

      default:
        // Log ALL unknown types at info level so we can discover friend/PM event names
        this.log?.info(`[ChatCommon] Unhandled type: ${msg.type} keys=${Object.keys(msg).join(',')}`);
        break;
    }
  }

  // ── Nick helpers ───────────────────────────────────────────────────────────

  _setNick(roomName, nick, handle) {
    if (!nick || !handle) return;
    this._nickMap.set(`${roomName}:${nick.toLowerCase()}`, handle);
    this._nickMap.set(`${roomName}:handle:${handle}`, nick);
  }

  _getNickByHandle(roomName, handle) {
    return this._nickMap.get(`${roomName}:handle:${handle}`) || null;
  }

  getHandle(roomName, nick) {
    return this._nickMap.get(`${roomName}:${(nick || '').toLowerCase()}`) || null;
  }

  _getPrimaryRoom() {
    for (const r of this._joinedRooms) return r;
    for (const r of this._rooms)       return r;
    return null;
  }
}

module.exports = ChatCommonClient;
