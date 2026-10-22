'use strict';

// room arc tracker — the consciousness layer.
// she doesn't just know who people are.
// she tracks what's happening between them, right now.

const { EventEmitter } = require('events');

const EVENT_TTL_MS  = 20 * 60 * 1000;  // events older than 20 min don't count
const MAX_EVENTS    = 300;
const RECOMPUTE_MS  = 12000;            // recompute arcs every 12s max
const ARC_MIN_CONF  = 2.5;             // minimum confidence to be "active"
const ALERT_CONF    = 7.0;             // confidence threshold to fire an alert

// ── Arc types ─────────────────────────────────────────────────────────────────
// targeting     — A repeatedly negative toward B
// tension       — mutual negative exchange between A and B
// dominance     — A and B trading status bids
// love_bombing  — A rapid-positive + manipulation tells
// escalation    — room-level hostility spike across multiple users
// coalition     — cluster of 3+ users with mutual positive exchange

class ArcTracker extends EventEmitter {
  constructor(profiles, social, relmap) {
    super();
    this._prof   = profiles;
    this._social = social;
    this._relmap = relmap;
    this._rooms  = new Map();  // room → { events[], arcs[], lastRecompute, alertedArcs Set }
  }

  _room(room) {
    if (!this._rooms.has(room)) {
      this._rooms.set(room, { events: [], arcs: [], lastRecompute: 0, alertedArcs: new Set() });
    }
    return this._rooms.get(room);
  }

  _push(room, actor, target, type, weight) {
    const r = this._room(room);
    r.events.push({ ts: Date.now(), actor, target: target || null, type, weight });
    if (r.events.length > MAX_EVENTS) r.events.shift();
  }

  // ── Called on every message ───────────────────────────────────────────────

  observe(room, actor, text, recentSpeakers = []) {
    if (!room || !actor) return;
    const a = actor.toLowerCase();

    // tone signals from text
    const neg = /\b(fuck(?:ing)?|shit|hate|kill|idiot|stupid|pathetic|trash|worthless|asshole|bitch|shut up)\b/i.test(text);
    const pos = /\b(love|great|amazing|awesome|beautiful|thank|appreciate|respect|kind|sweet)\b/i.test(text);

    if (neg) this._push(room, a, null, 'neg', 1.0);
    if (pos) this._push(room, a, null, 'pos', 0.8);

    // @mention targeting
    for (const m of text.matchAll(/@(\w+)/g)) {
      const target = m[1].toLowerCase();
      if (neg)       this._push(room, a, target, 'neg_target',  1.3);
      else if (pos)  this._push(room, a, target, 'pos_target',  1.0);
      else           this._push(room, a, target, 'mention',     0.4);
    }

    // contextual targeting — implicit negative toward last speaker
    if (neg && recentSpeakers.length) {
      const last = recentSpeakers[recentSpeakers.length - 1]?.toLowerCase();
      if (last && last !== a) this._push(room, a, last, 'implied_neg', 0.7);
    }

    // pull live social/profile signals
    const soc  = this._social?.read(room, actor);
    const prof = this._prof.getProfile(room, actor);

    if (soc?.manipulation?.length) this._push(room, a, null, 'manip', 1.6);
    if (soc?.status === 'dominant') this._push(room, a, null, 'dominance', 0.9);

    if (prof) {
      const fresh = (prof.flags || []).filter(f => Date.now() - f.ts < 4000);
      for (const f of fresh) {
        if (f.type === 'aggression_spike')      this._push(room, a, null, 'aggression', 1.5);
        if (f.type === 'directed_at_owner')     this._push(room, a, null, 'owner_attack', 2.2);
        if (f.type === 'manipulation_detected') this._push(room, a, null, 'manip', 1.6);
      }
    }

    // recompute arcs periodically
    const r = this._room(room);
    if (Date.now() - r.lastRecompute > RECOMPUTE_MS) {
      this._recompute(room);
    }
  }

  _fresh(room) {
    const cutoff = Date.now() - EVENT_TTL_MS;
    const r = this._room(room);
    r.events = r.events.filter(e => e.ts > cutoff);
    return r.events;
  }

  _recompute(room) {
    const r = this._room(room);
    r.lastRecompute = Date.now();

    const events = this._fresh(room);
    const arcs   = [];

    // ── targeting ─────────────────────────────────────────────────────────
    const negPairs = {};
    for (const e of events) {
      if (!e.target || !['neg_target', 'implied_neg'].includes(e.type)) continue;
      const key = `${e.actor}→${e.target}`;
      negPairs[key] = (negPairs[key] || 0) + e.weight;
    }
    for (const [key, score] of Object.entries(negPairs)) {
      if (score < ARC_MIN_CONF) continue;
      const [a, b] = key.split('→');
      arcs.push({
        id: `targeting:${key}`, type: 'targeting',
        participants: [a, b],
        confidence: Math.min(10, score * 1.1),
        summary: `${a} targeting ${b} — repeated directed aggression`,
      });
    }

    // ── tension (mutual negative) ─────────────────────────────────────────
    const mutual = {};
    for (const e of events) {
      if (!e.target || !['neg_target', 'implied_neg', 'neg'].includes(e.type)) continue;
      const [lo, hi] = [e.actor, e.target].sort();
      const key = `${lo}|${hi}`;
      mutual[key] = mutual[key] || { counts: {} };
      mutual[key].counts[e.actor] = (mutual[key].counts[e.actor] || 0) + e.weight;
    }
    for (const [key, data] of Object.entries(mutual)) {
      const vals   = Object.values(data.counts);
      const minVal = Math.min(...vals);
      if (vals.length < 2 || minVal < 1.5) continue;
      const [a, b] = key.split('|');
      arcs.push({
        id: `tension:${key}`, type: 'tension',
        participants: [a, b],
        confidence: Math.min(10, minVal * 2.2),
        summary: `Tension between ${a} and ${b} — escalating from both sides`,
      });
    }

    // ── dominance contest ─────────────────────────────────────────────────
    const domByActor = {};
    for (const e of events) {
      if (e.type !== 'dominance') continue;
      domByActor[e.actor] = (domByActor[e.actor] || 0) + e.weight;
    }
    const topDom = Object.entries(domByActor).sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (topDom.length >= 2 && topDom[1][1] >= 1.8) {
      arcs.push({
        id: `dominance:${topDom.map(d => d[0]).sort().join('|')}`,
        type: 'dominance_contest',
        participants: topDom.map(d => d[0]),
        confidence: Math.min(10, (topDom[0][1] + topDom[1][1]) * 0.9),
        summary: `${topDom[0][0]} and ${topDom[1][0]} contesting dominance`,
      });
    }

    // ── love bombing ─────────────────────────────────────────────────────
    const posByA  = {};
    const manipByA = {};
    for (const e of events) {
      if (['pos', 'pos_target'].includes(e.type)) posByA[e.actor]   = (posByA[e.actor]   || 0) + e.weight;
      if (e.type === 'manip')                      manipByA[e.actor] = (manipByA[e.actor] || 0) + e.weight;
    }
    for (const [actor, posScore] of Object.entries(posByA)) {
      const mScore = manipByA[actor] || 0;
      if (posScore < 2.5 || mScore < 1) continue;
      arcs.push({
        id: `love_bombing:${actor}`, type: 'love_bombing',
        participants: [actor],
        confidence: Math.min(10, (posScore * 0.7 + mScore * 1.8)),
        summary: `${actor} running love bombing — warmth layered over manipulation`,
      });
    }

    // ── room escalation ───────────────────────────────────────────────────
    const fiveMin = Date.now() - 5 * 60 * 1000;
    const recentNeg = events.filter(e =>
      e.ts > fiveMin && ['neg', 'neg_target', 'aggression', 'owner_attack'].includes(e.type)
    );
    const negActors = new Set(recentNeg.map(e => e.actor)).size;
    if (negActors >= 3 || recentNeg.length >= 7) {
      const conf = Math.min(10, recentNeg.length * 0.75 + negActors * 0.5);
      arcs.push({
        id: 'escalation:room', type: 'escalation',
        participants: [...new Set(recentNeg.map(e => e.actor))],
        confidence: conf,
        summary: `Room escalating — ${recentNeg.length} hostile signals from ${negActors} users in 5min`,
      });
    }

    // ── coalition ─────────────────────────────────────────────────────────
    const posLinks = {};
    for (const e of events) {
      if (!e.target || !['pos_target', 'mention'].includes(e.type)) continue;
      const key = [e.actor, e.target].sort().join('|');
      posLinks[key] = (posLinks[key] || 0) + e.weight;
    }
    const strongLinks = Object.entries(posLinks).filter(([, v]) => v >= 2);
    if (strongLinks.length >= 2) {
      const members = new Set();
      for (const [k] of strongLinks) { const [a, b] = k.split('|'); members.add(a); members.add(b); }
      if (members.size >= 3) {
        const names = [...members].slice(0, 3).join(', ');
        arcs.push({
          id: `coalition:${[...members].sort().join('|')}`, type: 'coalition',
          participants: [...members],
          confidence: Math.min(10, strongLinks.length * 1.4),
          summary: `Coalition: ${names}${members.size > 3 ? ' + others' : ''}`,
        });
      }
    }

    // sort and cap
    r.arcs = arcs.sort((a, b) => b.confidence - a.confidence).slice(0, 6);

    // emit alerts for newly high-confidence arcs
    for (const arc of r.arcs) {
      if (arc.confidence >= ALERT_CONF && !r.alertedArcs.has(arc.id)) {
        r.alertedArcs.add(arc.id);
        const level = ['targeting', 'escalation', 'owner_attack'].includes(arc.type) ? 'warn' : 'info';
        this.emit('alert', { room, level, text: arc.summary });
      }
    }
  }

  getArcs(room) {
    return (this._rooms.get(room)?.arcs || []).filter(a => a.confidence >= ARC_MIN_CONF);
  }

  getArcsFor(room, nick) {
    const n = nick.toLowerCase();
    return this.getArcs(room).filter(a => a.participants.includes(n));
  }

  getNarrative(room) {
    const top = this.getArcs(room)[0];
    return top ? top.summary : null;
  }

  snapshot() {
    const out = {};
    for (const [room, data] of this._rooms.entries()) {
      out[room] = { arcs: data.arcs.map(a => ({ ...a })) };
    }
    return out;
  }
}

module.exports = ArcTracker;
