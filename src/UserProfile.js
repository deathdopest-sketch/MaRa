'use strict';

// everyone has a pattern. mara sees it. you can't hide from her.

let _NNN = null;
function _getNNN() {
  if (!_NNN) {
    try { _NNN = new (require('../NNNProcessor'))(); } catch { /* optional */ }
  }
  return _NNN;
}

const STOP_WORDS = new Set([
  'this','that','with','from','have','they','your','what','when','where','will',
  'been','were','just','like','know','think','because','there','their','these',
  'those','then','than','some','into','over','also','very','much','more','only',
]);

const NEG_RX  = /\b(fuck(?:ing)?|shit(?:ty)?|bitch|whore|slut|cunt|asshole|bastard|idiot|stupid|loser|disgusting|kill yourself|kys|retard(?:ed)?|moron|dumbass|pathetic|worthless|trash|garbage|piss off|shut up|hate you)\b/gi;
const POS_RX  = /\b(thanks|thank you|appreciate|love that|great|awesome|beautiful|nice|kind|sweet|well done|wonderful|amazing|incredible|respect|helpful|glad|happy|good job|brilliant|fantastic|legend)\b/gi;
const VAGUE_RX= /\b(maybe|dunno|idk|idc|possibly|might|could be|who knows|not sure|whatever|meh)\b/gi;
const CONF_RX = /\b(definitely|absolutely|obviously|clearly|for sure|trust me|guaranteed|i know|facts|no doubt|100%)\b/gi;
const ATTN_RX = /\b(everyone|hey guys|anyone here|nobody cares|look at me|is anyone|hello\?)\b/gi;
const CLAIM_RX= /\bi (was|am|have|had|went|did|used to|said|told|saw|heard|know|met|found|thought)\b[^.!?]{5,60}/gi;

class UserProfiles {
  constructor() {
    this._rooms = new Map();
  }

  _roomMap(room) {
    if (!this._rooms.has(room)) this._rooms.set(room, new Map());
    return this._rooms.get(room);
  }

  _profile(room, nick) {
    const map = this._roomMap(room);
    const key = nick.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        nick,
        room,
        firstSeen:        Date.now(),
        lastSeen:         Date.now(),
        messages:         0,
        sessionMessages:  0,
        questions:        0,
        totalLength:      0,
        avgLength:        0,
        exclamations:     0,
        style:            'lurker',
        energy:           'low',
        topics:           new Map(),
        wordFreq:         new Map(),
        mentionedBy:      new Set(),
        mentions:         new Set(),
        joinCount:        0,
        leaveCount:       0,
        recentTs:         [],
        nickHistory:      [],

        // tone counters
        positiveCount:    0,
        negativeCount:    0,
        neutralCount:     0,
        recentTones:      [],   // last 20: 'positive'|'negative'|'neutral'

        // trait scores (float 0–10)
        moralityScore:       5.0,
        cunningScore:        3.0,
        formidabilityScore:  3.0,
        volatilityScore:     3.0,

        // flags
        flags:              [],  // { type, ts, detail }
        aggressionSpikes:   0,
        directedHostility:  0,
        batchCount:         0,   // rapid-fire short message runs

        // story tracking for inconsistency detection
        storyStatements:    [],  // { ts, claim }

        // temporal patterns — message count per hour of day (0–23)
        hourCounts:         new Array(24).fill(0),
      });
    }
    return map.get(key);
  }

  observe(room, nick, text) {
    if (!room || !nick) return;
    const p   = this._profile(room, nick);
    const now = Date.now();
    const t   = String(text || '');

    p.lastSeen = now;
    p.messages++;
    p.sessionMessages++;

    if (/\?/.test(t)) p.questions++;
    if (/!/.test(t))  p.exclamations++;
    p.totalLength += t.length;
    p.avgLength    = Math.round(p.totalLength / p.messages);

    p.recentTs.push(now);
    if (p.recentTs.length > 10) p.recentTs.shift();
    p.hourCounts[new Date(now).getHours()]++;

    // ── message batching ─────────────────────────────────────────
    // 3+ short messages within 8 seconds = batching behaviour
    if (t.length < 60 && p.recentTs.length >= 3) {
      const tail = p.recentTs.slice(-3);
      if (tail[2] - tail[0] < 8000) {
        p.batchCount++;
        if (p.batchCount % 3 === 1) {  // flag every third batch run, not every message
          this._addFlag(p, 'message_batching', `×${p.batchCount}`);
        }
      }
    }

    // @mentions
    for (const m of t.matchAll(/@(\w+)/g)) p.mentions.add(m[1].toLowerCase());
    const roomMap = this._roomMap(room);
    for (const m of t.matchAll(/@(\w+)/g)) {
      const tp = roomMap.get(m[1].toLowerCase());
      if (tp) tp.mentionedBy.add(nick.toLowerCase());
    }

    // topics + word freq
    this._extractTopics(t, p.topics);
    this._trackWords(t, p.wordFreq);

    // ── tone signals ────────────────────────────────────────────
    const negHits = (t.match(NEG_RX)  || []).length;
    const posHits = (t.match(POS_RX)  || []).length;
    p.negativeCount += negHits;
    p.positiveCount += posHits;
    if (!negHits && !posHits) p.neutralCount++;

    const msgTone = negHits > posHits ? 'negative' : posHits > negHits ? 'positive' : 'neutral';
    p.recentTones.push(msgTone);
    if (p.recentTones.length > 20) p.recentTones.shift();

    // ── aggression spike ────────────────────────────────────────
    if (negHits >= 3) {
      p.aggressionSpikes++;
      this._addFlag(p, 'aggression_spike', t.slice(0, 60));
    }

    // ── attention seeking ───────────────────────────────────────
    if (ATTN_RX.test(t)) this._addFlag(p, 'attention_seeking', '');

    // ── morality ────────────────────────────────────────────────
    p.moralityScore = clamp(p.moralityScore - negHits * 0.4 + posHits * 0.2, 0, 10);

    // ── cunning ─────────────────────────────────────────────────
    const vagueHits = (t.match(VAGUE_RX) || []).length;
    if (/\?/.test(t))   p.cunningScore = clamp(p.cunningScore + 0.1, 0, 10);
    if (vagueHits > 0)  p.cunningScore = clamp(p.cunningScore + vagueHits * 0.2, 0, 10);

    // ── formidability ───────────────────────────────────────────
    const confHits = (t.match(CONF_RX) || []).length;
    if (confHits > 0)   p.formidabilityScore = clamp(p.formidabilityScore + confHits * 0.3, 0, 10);
    if (p.mentionedBy.size >= 3) p.formidabilityScore = clamp(p.formidabilityScore + 0.05, 0, 10);

    // ── NNN deep analysis ────────────────────────────────────────
    const nnn = _getNNN();
    if (nnn) {
      const r = nnn.process(t);
      p.nnnScore = r.score;

      if (r.hostility > 0.35) {
        p.moralityScore = clamp(p.moralityScore - r.hostility * 0.5, 0, 10);
        if (r.hostility > 0.6) {
          p.aggressionSpikes++;
          this._addFlag(p, 'hostility_spike', `NNN:${r.hostility.toFixed(2)}`);
        }
      }
      if (r.manipDetected) {
        p.cunningScore = clamp(p.cunningScore + 0.3, 0, 10);
        this._addFlag(p, 'manipulation_detected', '');
      }
      // flirtMode = D8 (owner name recognition: death/d-d/kenneth/boss) — if that fires
      // alongside real hostility, someone is being aggressive directed at the owner
      if (r.hostility > 0.3 && r.flirtMode) {
        p.directedHostility = (p.directedHostility || 0) + 1;
        this._addFlag(p, 'directed_at_owner', `hostility:${r.hostility.toFixed(2)}`);
      }
      if (r.existential) {
        this._addFlag(p, 'existential_themes', '');
      }
      if (r.intimacy > 0.5) {
        this._addFlag(p, 'vulnerability_signal', `nnn:${r.intimacy.toFixed(2)}`);
      }
      if (r.roleplaySignal) {
        this._addFlag(p, 'roleplay_mode', '');
      }
      // formidability boost: authority challengers + high NNN score
      if (r.authorityChallenge) {
        p.formidabilityScore = clamp(p.formidabilityScore + 0.2, 0, 10);
      }
    }

    // ── volatility ──────────────────────────────────────────────
    p.volatilityScore = this._computeVolatility(p.recentTones);

    // ── story / inconsistency tracking ──────────────────────────
    CLAIM_RX.lastIndex = 0;
    for (const m of t.matchAll(CLAIM_RX)) {
      const claim = m[0].toLowerCase().trim();
      // simple contradiction: same 4-letter+ word appears in two claims with different verbs
      for (const prev of p.storyStatements.slice(-5)) {
        if (this._claimsContradict(prev.claim, claim)) {
          this._addFlag(p, 'story_inconsistency', `"${prev.claim.slice(0,40)}" vs "${claim.slice(0,40)}"`);
        }
      }
      p.storyStatements.push({ ts: now, claim });
      if (p.storyStatements.length > 10) p.storyStatements.shift();
    }

    // recompute derived fields
    p.style  = this._computeStyle(p, roomMap);
    p.energy = this._computeEnergy(p);
  }

  _addFlag(p, type, detail) {
    p.flags.push({ type, ts: Date.now(), detail });
    if (p.flags.length > 30) p.flags.shift();
  }

  onJoin(room, nick) {
    if (!room || !nick) return;
    this._profile(room, nick).joinCount++;
  }

  onLeave(room, nick) {
    if (!room || !nick) return;
    const p = this._roomMap(room).get(nick.toLowerCase());
    if (p) p.leaveCount++;
  }

  onNickChange(room, oldNick, newNick) {
    if (!room || !oldNick || !newNick) return;
    const map = this._roomMap(room);
    const p   = map.get(oldNick.toLowerCase());
    if (!p) return;
    p.nickHistory.push({ nick: newNick, ts: Date.now() });
    p.nick = newNick;
    map.set(newNick.toLowerCase(), p);
    // keep old key too (so old references still resolve)
  }

  getProfile(room, nick) {
    return this._roomMap(room).get(nick.toLowerCase()) || null;
  }

  getAllProfiles(room) {
    return [...this._roomMap(room).values()].sort((a, b) => b.messages - a.messages);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  _extractTopics(text, topicMap) {
    for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length < 4 || STOP_WORDS.has(w)) continue;
      topicMap.set(w, (topicMap.get(w) || 0) + 1);
    }
    if (topicMap.size > 20) {
      const sorted = [...topicMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
      topicMap.clear();
      for (const [k, v] of sorted) topicMap.set(k, v);
    }
  }

  _trackWords(text, wordFreq) {
    for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length < 2) continue;
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    }
    if (wordFreq.size > 200) {
      const sorted = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100);
      wordFreq.clear();
      for (const [k, v] of sorted) wordFreq.set(k, v);
    }
  }

  _computeVolatility(tones) {
    if (tones.length < 4) return 3;
    let changes = 0;
    for (let i = 1; i < tones.length; i++) {
      if (tones[i] !== tones[i - 1]) changes++;
    }
    return clamp(Math.round((changes / (tones.length - 1)) * 10), 0, 10);
  }

  _claimsContradict(a, b) {
    const wordsA = new Set(a.split(/\W+/).filter(w => w.length > 4));
    const wordsB = new Set(b.split(/\W+/).filter(w => w.length > 4));
    const shared = [...wordsA].filter(w => wordsB.has(w)).length;
    // require shared context words but different verb immediately after "i "
    const verbA = (a.match(/^i (\w+)/) || [])[1];
    const verbB = (b.match(/^i (\w+)/) || [])[1];
    return shared >= 2 && verbA && verbB && verbA !== verbB;
  }

  _computeStyle(p, roomMap) {
    if (p.messages < 5) return 'lurker';
    if (p.questions / p.messages > 0.35) return 'questioner';
    if (p.avgLength > 160) return 'ranter';
    if (p.avgLength < 25 && p.exclamations / p.messages > 0.4) return 'chaos agent';

    const closeReplies = p.recentTs.filter((ts, i) => i > 0 && ts - p.recentTs[i - 1] < 10_000).length;
    if (p.recentTs.length > 3 && closeReplies / p.recentTs.length > 0.5) return 'reactor';

    const all = [...roomMap.values()];
    if (all.length > 2) {
      const avgMsgs = all.reduce((s, q) => s + q.messages, 0) / all.length;
      const avgLen  = all.reduce((s, q) => s + q.avgLength, 0) / all.length;
      if (p.messages >= avgMsgs * 1.5 && p.avgLength >= avgLen) return 'leader';
    }

    return 'regular';
  }

  _computeEnergy(p) {
    if (p.messages < 3) return 'low';
    const sessionMs  = Math.max(1, p.lastSeen - p.firstSeen);
    const msgsPerHr  = (p.messages / sessionMs) * 3_600_000;
    if (msgsPerHr >= 20) return 'high';
    if (msgsPerHr >= 6)  return 'medium';
    return 'low';
  }

  vocabRichness(p) {
    if (!p.wordFreq || p.messages < 5) return null;
    const unique = p.wordFreq.size;
    const total  = [...p.wordFreq.values()].reduce((s, v) => s + v, 0);
    if (total === 0) return null;
    const ratio = unique / total;
    if (ratio > 0.7) return 'rich';
    if (ratio > 0.4) return 'average';
    return 'repetitive';
  }

  dominance(room, nick) {
    const all   = this.getAllProfiles(room);
    const total = all.reduce((s, p) => s + p.messages, 0);
    const p     = this.getProfile(room, nick);
    if (!p || total === 0) return 0;
    return Math.round((p.messages / total) * 100);
  }

  snapshot() {
    const out = {};
    for (const [room, map] of this._rooms.entries()) {
      out[room] = {};
      for (const [key, p] of map.entries()) {
        out[room][key] = {
          ...p,
          topics:          Object.fromEntries(p.topics),
          wordFreq:        Object.fromEntries(p.wordFreq),
          mentionedBy:     [...p.mentionedBy],
          mentions:        [...p.mentions],
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
          topics:      new Map(Object.entries(p.topics    || {})),
          wordFreq:    new Map(Object.entries(p.wordFreq  || {})),
          mentionedBy: new Set(p.mentionedBy || []),
          mentions:    new Set(p.mentions    || []),
          recentTs:    p.recentTs    || [],
          recentTones: p.recentTones || [],
          nickHistory: p.nickHistory || [],
          flags:       p.flags       || [],
          storyStatements: p.storyStatements || [],
          hourCounts:      p.hourCounts     || new Array(24).fill(0),
          sessionMessages: 0,  // reset on reload — session is current run only
        });
      }
    }
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

module.exports = UserProfiles;
