'use strict';

// silent as the grave. she connects, she listens, she never says a word.

const { EventEmitter } = require('events');
const ChatCommonClient = require('../lib/ChatCommonClient');

const _log = {
  info : (...a) => process.env.DEBUG_MARA && console.log ('[CC]',  ...a),
  warn : (...a) => console.warn ('[CC:WARN]', ...a),
  error: (...a) => console.error('[CC:ERR]',  ...a),
  debug: (...a) => process.env.DEBUG_MARA && console.log ('[CC:DBG]', ...a),
};

class ChatCommonAdapter extends EventEmitter {
  constructor(username, password, rooms) {
    super();
    this._rooms  = rooms;
    this._client = new ChatCommonClient(username, password, _log);
    this._wired  = false;
  }

  async connect() {
    if (!this._wired) this._wire();
    for (const r of this._rooms) this._client.joinRoom(r);
    await this._client.connect();
  }

  async disconnect() {
    await this._client.disconnect();
  }

  _wire() {
    this._wired = true;
    const c = this._client;

    c.cb.onMessage = (room, nick, text, handle) =>
      this.emit('message', { room, nick, text, handle });

    c.cb.onJoin = (room, nick, handle, username, mod) =>
      this.emit('join', { room, nick, handle, username, mod });

    c.cb.onLeave = (room, nick, handle) =>
      this.emit('leave', { room, nick, handle });

    c.cb.onJoined = (room, nick, handle, username) => {
      this.emit('connected', { room });
    };

    c.cb.onUserList = (room, users) =>
      this.emit('userlist', { room, users });

    c.cb.onNickChange = (room, oldNick, newNick, handle) =>
      this.emit('nickChange', { room, oldNick, newNick, handle });

    c.cb.onClosed = (room) =>
      this.emit('disconnected', { room });

    c.cb.onReconnected = (room) =>
      this.emit('connected', { room });
  }

  get rooms() { return this._rooms; }
}

module.exports = ChatCommonAdapter;
