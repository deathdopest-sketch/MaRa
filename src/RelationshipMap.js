'use strict';

// death built this. knows too well how rooms work.

const STOP_WORDS = new Set(['this','that','with','from','have','they','your','what','when','where','will','been','were','just','like','know','think','because','there','their','these','those']);

class RelationshipMap {
  constructor() {
    // room → Map<pairKey, edge>
    this._rooms = new Map();
    // room → recent speakers queue [{nick, ts}]
    this._recent = new Map();
  }

  _roomEdges(room) {
    if (!this._rooms.has(room)) this._rooms.set(room, new Map());
    return this._rooms.get(room);
  }

  _recentFor(room) {
    if (!this._recent.has(room)) this._recent.set(room, []);
    return this._recent.get(room);
  }

  _pairKey(a, b) {
    return [a, b].sort().join('\x00');
  }

  _getEdge(room, a, b) {
    const edges = this._roomEdges(room);
    const key   = this._pairKey(a, b);
    if (!edges.has(key)) {
      edges.set(key, { a, b, strength: 0, exchangeCount: 0, tone: 'neutral', toneScores: { friendly: 0, hostile: 0, flirty: 0, intellectual: 0 } });
    }
    return edges.get(key);
  }

  observe(room, nick, text, allRecentNicks) {
    if (!room || !nick) return;
    const t = (text || '').toLowerCase();

    // update recent speakers
    const recent = this._recentFor(room);
    const now    = Date.now();
    recent.push({ nick, ts: now });
    const cutoff = now - 15_000;
    while (recent.length > 10) recent.shift();

    // @mentions — strong direct signal
    const mentions = [];
    for (const m of (text || '').matchAll(/@(\w+)/g)) {
      mentions.push(m[1].toLowerCase());
    }

    for (const target of mentions) {
      if (target === nick.toLowerCase()) continue;
      const edge = this._getEdge(room, nick.toLowerCase(), target);
      edge.exchangeCount++;
      edge.strength = Math.min(10, edge.strength + 1.5);
      this._scoreTone(edge, nick.toLowerCase(), target, t);
    }

    // proximity signal — anyone who spoke in last 15s
    const proxNicks = recent
      .filter(e => e.nick !== nick && now - e.ts < 15_000)
      .map(e => e.nick.toLowerCase());
    const seen = new Set(mentions.map(m => m.toLowerCase()));
    for (const other of proxNicks) {
      if (seen.has(other)) continue;
      const edge = this._getEdge(room, nick.toLowerCase(), other);
      edge.exchangeCount++;
      edge.strength = Math.min(10, edge.strength + 0.3);
      this._scoreTone(edge, nick.toLowerCase(), other, t);
    }

    // recompute tone for all edges involving this nick
    const edges = this._roomEdges(room);
    for (const edge of edges.values()) {
      if (edge.a === nick.toLowerCase() || edge.b === nick.toLowerCase()) {
        edge.tone = this._dominantTone(edge.toneScores);
      }
    }
  }

  _scoreTone(edge, from, to, t) {
    if (/@\w/.test(t) && /fuck|idiot|stupid|shut|hate|loser/.test(t))          edge.toneScores.hostile    += 2;
    else if (/@\w/.test(t) && /lol|haha|same|true|exactly|right|yeah|love/.test(t)) edge.toneScores.friendly   += 2;
    else if (/@\w/.test(t) && /hot|cute|pretty|nice|miss|bb|babe|sexy/.test(t))     edge.toneScores.flirty     += 2;
    else if (/@\w/.test(t) && /think|because|mean|point|agree|but|actually/.test(t)) edge.toneScores.intellectual += 2;
    // softer signals from plain proximity
    else if (/lol|haha|nice|same/.test(t))                                          edge.toneScores.friendly   += 0.5;
    else if (/wtf|really|no|come on|stop/.test(t))                                  edge.toneScores.hostile    += 0.3;
  }

  _dominantTone(scores) {
    let top = 'neutral', max = 0;
    for (const [k, v] of Object.entries(scores)) {
      if (v > max) { max = v; top = k; }
    }
    return max < 1 ? 'neutral' : top;
  }

  getRelationships(room) {
    const edges = this._roomEdges(room);
    return [...edges.values()]
      .filter(e => e.strength >= 1)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 15);
  }

  getAllianceGroups(room) {
    const edges = this.getRelationships(room).filter(e => e.strength >= 3 && e.tone !== 'hostile');
    const graph = new Map();
    for (const e of edges) {
      if (!graph.has(e.a)) graph.set(e.a, new Set());
      if (!graph.has(e.b)) graph.set(e.b, new Set());
      graph.get(e.a).add(e.b);
      graph.get(e.b).add(e.a);
    }
    const visited = new Set();
    const groups  = [];
    for (const node of graph.keys()) {
      if (visited.has(node)) continue;
      const group = [];
      const queue = [node];
      while (queue.length) {
        const n = queue.shift();
        if (visited.has(n)) continue;
        visited.add(n);
        group.push(n);
        for (const nb of (graph.get(n) || [])) {
          if (!visited.has(nb)) queue.push(nb);
        }
      }
      if (group.length >= 2) groups.push(group);
    }
    return groups.slice(0, 5);
  }

  getTensions(room) {
    return this.getRelationships(room).filter(e => e.tone === 'hostile' && e.strength >= 2);
  }

  snapshot() {
    const out = {};
    for (const [room, edges] of this._rooms.entries()) {
      out[room] = [...edges.values()].map(e => ({
        ...e,
        toneScores: { ...e.toneScores },
      }));
    }
    return out;
  }

  fromSnapshot(data) {
    if (!data || typeof data !== 'object') return;
    for (const [room, edges] of Object.entries(data)) {
      const map = this._roomEdges(room);
      for (const e of (edges || [])) {
        const key = this._pairKey(e.a, e.b);
        map.set(key, { ...e, toneScores: { ...e.toneScores } });
      }
    }
  }
}

module.exports = RelationshipMap;
