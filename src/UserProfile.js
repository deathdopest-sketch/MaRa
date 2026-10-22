'use strict';

// everyone has a pattern. mara sees it. you can't hide from her.

const STOP_WORDS = new Set([
  'this','that','with','from','have','they','your','what','when','where','will',
  'been','were','just','like','know','think','because','there','their','these',
  'those','then','than','some','into','over','also','very','much','more','only',
]);

class UserProfiles {
  constructor() {
    // room → nick → profile
    this._rooms = new Map();
  }

  _roomMap(room) {
    if (!this._rooms.has(room)) this._rooms.set(room, new Map());
    return this._rooms.get(room);
  }

  _profile(room, nick) {
    const map  = this._roomMap(room);
    const key  = nick.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        nick,
        room,
        firstSeen:   Date.now(),
        lastSeen:    Date.now(),
        messages:    0,
        questions:   0,
        totalLength: 0,
        avgLength:   0,
        exclamations: 0,
        style:       'lurker',
        energy:      'low',
        topics:      new Map(),
        mentionedBy: new Set(),
        mentions:    new Set(),
        joinCount:   0,
        leaveCount:  0,
        recentTs:    [],    // last 10 message timestamps for timing analysis
      });
    }
    return map.get(key);
  }

  observe(room, nick, text) {
    if (!room || !nick) return;
    const p   = this._profile(room, nick);
    const now = Date.now();

    p.lastSeen = now;
    p.messages++;

    const t = text || '';
    if (/\?/.test(t))  p.questions++;
    if (/!/.test(t))   p.exclamations++;
    p.totalLength += t.length;
    p.avgLength    = Math.round(p.totalLength / p.messages);

    p.recentTs.push(now);
    if (p.recentTs.length > 10) p.recentTs.shift();

    // extract @mentions
    for (const m of t.matchAll(/@(\w+)/g)) {
      p.mentions.add(m[1].toLowerCase());
    }

    // mentioned by others — handled at the map level via observe
    // (we'll track "mentioned by" from other users calling observe with @nick in text)
    const mentions = [...t.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase());
    const roomMap  = this._roomMap(room);
    for (const target of mentions) {
      const tp = roomMap.get(target);
      if (tp) tp.mentionedBy.add(nick.toLowerCase());
    }

    this._extractTopics(t, p.topics);
    p.style  = this._computeStyle(p, roomMap);
    p.energy = this._computeEnergy(p);
  }

  onJoin(room, nick) {
    if (!room || !nick) return;
    this._profile(room, nick).joinCount++;
  }

  onLeave(room, nick) {
    if (!room || !nick) return;
    const map = this._roomMap(room);
    const p   = map.get(nick.toLowerCase());
    if (p) p.leaveCount++;
  }

  getProfile(room, nick) {
    return this._roomMap(room).get(nick.toLowerCase()) || null;
  }

  getAllProfiles(room) {
    return [...this._roomMap(room).values()]
      .sort((a, b) => b.messages - a.messages);
  }

  _extractTopics(text, topicMap) {
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const w of words) {
      if (w.length < 4 || STOP_WORDS.has(w)) continue;
      topicMap.set(w, (topicMap.get(w) || 0) + 1);
    }
    // cap at 15
    if (topicMap.size > 15) {
      const sorted = [...topicMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
      topicMap.clear();
      for (const [k, v] of sorted) topicMap.set(k, v);
    }
  }

  _computeStyle(p, roomMap) {
    if (p.messages < 5) return 'lurker';
    if (p.questions / p.messages > 0.3) return 'questioner';
    if (p.avgLength > 150) return 'ranter';
    if (p.avgLength < 30 && p.exclamations / p.messages > 0.4) return 'chaos';

    // reactor: messages often come within 10s of the previous speaker
    const closeReplies = p.recentTs.filter((ts, i) => i > 0 && ts - p.recentTs[i - 1] < 10_000).length;
    if (p.recentTs.length > 3 && closeReplies / p.recentTs.length > 0.5) return 'reactor';

    // leader: high count + above avg length
    const allProfiles = [...roomMap.values()];
    if (allProfiles.length > 2) {
      const avgRoomMsgs = allProfiles.reduce((s, q) => s + q.messages, 0) / allProfiles.length;
      const avgRoomLen  = allProfiles.reduce((s, q) => s + q.avgLength, 0) / allProfiles.length;
      if (p.messages >= avgRoomMsgs * 1.5 && p.avgLength >= avgRoomLen) return 'leader';
    }

    return 'regular';
  }

  _computeEnergy(p) {
    if (p.messages < 3) return 'low';
    // messages per hour based on session time
    const sessionMs  = Math.max(1, p.lastSeen - p.firstSeen);
    const msgsPerHr  = (p.messages / sessionMs) * 3_600_000;
    if (msgsPerHr >= 20) return 'high';
    if (msgsPerHr >= 6)  return 'medium';
    return 'low';
  }

  snapshot() {
    const out = {};
    for (const [room, map] of this._rooms.entries()) {
      out[room] = {};
      for (const [key, p] of map.entries()) {
        out[room][key] = {
          ...p,
          topics:      Object.fromEntries(p.topics.entries()),
          mentionedBy: [...p.mentionedBy],
          mentions:    [...p.mentions],
        };
      }
    }
    return out;
  }

  fromSnapshot(data) {
    if (!data || typeof data !== 'object') return;
    for (const [room, users] of Object.entries(data)) {
      const map = this._roomMap(room);
      for (const [key, p] of Object.entries(users)) {
        map.set(key, {
          ...p,
          topics:      new Map(Object.entries(p.topics || {})),
          mentionedBy: new Set(p.mentionedBy || []),
          mentions:    new Set(p.mentions    || []),
          recentTs:    p.recentTs || [],
        });
      }
    }
  }
}

module.exports = UserProfiles;
