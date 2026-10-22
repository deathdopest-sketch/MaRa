'use strict';

// same deal over on mumble. different platform, same void.

const { EventEmitter } = require('events');
const { io }           = require('socket.io-client');

let _socksAgent = null;
if (process.env.SOCKS_PROXY) {
  try {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    _socksAgent = new SocksProxyAgent(process.env.SOCKS_PROXY);
  } catch (_) {}
}

class MumbleAdapter extends EventEmitter {
  constructor(serverUrl, botKey, rooms) {
    super();
    this._url    = serverUrl || 'https://mumblechat.online';
    this._botKey = botKey;
    this._rooms  = rooms;
    this._socket = null;
    this._active = false;
  }

  async connect() {
    this._active = true;
    this._socket = io(this._url, {
      auth:        { botKey: this._botKey },
      transports:  ['websocket'],
      reconnection: true,
      reconnectionDelay:    2000,
      reconnectionDelayMax: 30000,
      ...(_socksAgent ? { extraHeaders: {}, agent: _socksAgent } : {}),
    });

    this._socket.on('connect', () => {
      for (const room of this._rooms) {
        this._socket.emit('joinRoom', { room });
      }
      this.emit('connected', { rooms: this._rooms });
    });

    this._socket.on('message', (data) => {
      const room = data.room || data.roomName || '';
      const nick = data.username || data.nick || '';
      const text = data.message || data.text || '';
      const handle = String(data.userId || data.user_id || nick);
      if (!nick || !text) return;
      this.emit('message', { room, nick, text, handle });
    });

    this._socket.on('user-joined', (data) => {
      const room = data.room || data.roomName || '';
      const nick = data.username || data.nick || '';
      const handle = String(data.userId || nick);
      this.emit('join', { room, nick, handle, username: nick, mod: 0 });
    });

    this._socket.on('user-left', (data) => {
      const room = data.room || data.roomName || '';
      const nick = data.username || data.nick || '';
      const handle = String(data.userId || nick);
      this.emit('leave', { room, nick, handle });
    });

    this._socket.on('room-users', (data) => {
      const room  = data.room || data.roomName || '';
      const users = (data.users || []).map(u => ({
        nick:     u.username || u.nick || '',
        handle:   String(u.userId || u.id || u.username || ''),
        username: u.username || '',
        mod:      u.role === 'mod' || u.role === 'owner' ? 1 : 0,
      })).filter(u => u.nick);
      this.emit('userlist', { room, users });
    });

    this._socket.on('nick-change', (data) => {
      const room    = data.room || data.roomName || '';
      const oldNick = data.oldNick || data.oldUsername || '';
      const newNick = data.newNick || data.newUsername || data.nick || '';
      const handle  = String(data.userId || '');
      this.emit('nickChange', { room, oldNick, newNick, handle });
    });

    this._socket.on('room-joined', (data) => {
      this.emit('connected', { room: data.name || data.room || '' });
    });

    this._socket.on('disconnect', () => {
      this.emit('disconnected', {});
    });

    this._socket.on('connect_error', (err) => {
      process.env.DEBUG_MARA && console.error('[Mumble] connect_error:', err.message);
    });

    return new Promise((resolve) => {
      this._socket.once('connect', resolve);
      setTimeout(resolve, 15000); // don't block forever
    });
  }

  async disconnect() {
    this._active = false;
    this._socket?.disconnect();
  }

  get rooms() { return this._rooms; }
}

module.exports = MumbleAdapter;
