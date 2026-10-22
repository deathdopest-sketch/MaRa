'use strict';

// rooms have moods. mara just reads them. like death reads people.

class RoomMood {
  constructor() {
    // room → { msgLog: number[], window: [{text,ts}], history: [] }
    this._rooms = new Map();
  }

  _room(name) {
    if (!this._rooms.has(name)) {
      this._rooms.set(name, { msgLog: [], window: [], history: [], lastSnap: 0 });
    }
    return this._rooms.get(name);
  }

  observe(room, nick, text) {
    if (!room) return;
    const r   = this._room(room);
    const now = Date.now();

    r.msgLog.push(now);
    const cutoff60 = now - 60_000;
    while (r.msgLog.length && r.msgLog[0] < cutoff60) r.msgLog.shift();

    if (text) {
      r.window.push({ text: String(text), ts: now });
      const cutoff120 = now - 120_000;
      while (r.window.length && r.window[0].ts < cutoff120) r.window.shift();
      if (r.window.length > 30) r.window.shift();
    }

    // snapshot history every 5 min
    if (now - r.lastSnap > 5 * 60_000) {
      r.history.push({ ts: now, energy: this.getEnergy(room), tone: this.getTone(room) });
      if (r.history.length > 20) r.history.shift();
      r.lastSnap = now;
    }
  }

  getEnergy(room) {
    const r = this._rooms.get(room);
    if (!r) return 'DEAD';
    const rate = r.msgLog.length;
    if (rate >= 30) return 'VOLATILE';
    if (rate >= 15) return 'HOT';
    if (rate >= 5)  return 'ACTIVE';
    if (rate >= 1)  return 'QUIET';
    return 'DEAD';
  }

  getTone(room) {
    const r = this._rooms.get(room);
    if (!r || !r.window.length) return 'MIXED';

    const counts = { drama: 0, hype: 0, sexual: 0, hostile: 0, weird: 0, chill: 0 };

    for (const { text } of r.window) {
      const t = text.toLowerCase();
      if (/fight|beef|hate|fuck you|stupid|idiot|drama|toxic/.test(t))      counts.drama++;
      if (/!!+|omg|yooo|fire|lets go|hype|sick|lit\b|mad\b|goat/.test(t))   counts.hype++;
      if (/horny|sexy|\bhot\b|cum\b|dick\b|pussy|fuck|wet\b|nude|ass\b/.test(t)) counts.sexual++;
      if (/\b(kill|die|hate|ugly|loser|retard|shut up)\b/.test(t) || /^[A-Z\s!?]{8,}$/.test(text)) counts.hostile++;
      if (/\b(idk|wtf|what|why|huh|random)\b|[?]{3,}/.test(t))              counts.weird++;
      if (/\b(yeah|nah|ok|mhm|cool|nice|real|true)\b/.test(t) && !counts.drama) counts.chill++;
    }

    let top = 'MIXED', max = 0;
    const map = { drama: 'DRAMA', hype: 'HYPE', sexual: 'SEXUAL', hostile: 'HOSTILE', weird: 'WEIRD', chill: 'CHILL' };
    for (const [k, label] of Object.entries(map)) {
      if (counts[k] > max) { max = counts[k]; top = label; }
    }
    return max === 0 ? 'MIXED' : top;
  }

  getMoodLine(room) {
    return `${this.getEnergy(room)} / ${this.getTone(room)}`;
  }

  getHistory(room) {
    return (this._rooms.get(room)?.history || []).slice();
  }

  snapshot() {
    const out = {};
    for (const [name, r] of this._rooms.entries()) {
      out[name] = { history: r.history, energy: this.getEnergy(name), tone: this.getTone(name) };
    }
    return out;
  }

  fromSnapshot(data) {
    if (!data || typeof data !== 'object') return;
    for (const [name, d] of Object.entries(data)) {
      const r = this._room(name);
      r.history = Array.isArray(d.history) ? d.history : [];
    }
  }
}

module.exports = RoomMood;
