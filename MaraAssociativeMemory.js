'use strict';

// MaraAssociativeMemory — cross-user pattern linking and concept recall
// Ported and rebuilt from DebbieDeadclaude/consciousness/AssociativeMemoryNetwork.js
//
// Debbie's version was a skeleton (all retrieval methods returned empty arrays).
// This is a working implementation built around what Mara actually needs:
//
//   - Concept graph: words/topics that co-occur across conversations, weighted by frequency
//   - Episodic store: significant moments per user with decay scoring
//   - Cross-user pattern linking: "X and Y both do this thing"
//   - Contextual retrieval: given current text, surface relevant past moments

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(
  process.env.MARA_DATA_DIR || path.join(__dirname, 'data'),
  'MaraMemory'
);
const AMN_FILE = path.join(DATA_DIR, 'associative_network.json');

const DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const MAX_EPISODES       = 500;
const MAX_CONCEPTS       = 300;
const MIN_RELEVANCE      = 0.25;

// ── Concept extraction ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must','can',
  'could','not','and','or','but','if','in','on','at','to','for','of','with',
  'it','this','that','these','those','i','you','he','she','we','they','me',
  'him','her','us','them','my','your','his','our','their','what','which','who',
  'how','when','where','why','just','like','yeah','ok','okay','lol','idk',
]);

function extractConcepts(text) {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 12);
}

// ── Decay scoring ─────────────────────────────────────────────────────────────

function decayScore(importance, ageMs) {
  const halfLives = ageMs / DECAY_HALF_LIFE_MS;
  return importance * Math.pow(0.5, halfLives);
}

// ── MaraAssociativeMemory class ────────────────────────────────────────────────

class MaraAssociativeMemory {
  constructor(logger) {
    this.log       = logger;
    this._concepts = new Map();  // concept → { freq, users: Set, lastSeen }
    this._episodes = [];         // { id, handle, nick, text, concepts, importance, ts, room }
    this._links    = new Map();  // "concept1|concept2" → weight
    this._dirty    = false;
    this._ensureDir();
    this._load();
  }

  // ── Store a moment ──────────────────────────────────────────────────────────

  store(handle, nick, text, room = null, importanceHint = 0.5) {
    const concepts = extractConcepts(text);
    if (!concepts.length) return;

    // Update concept graph
    for (const c of concepts) {
      const entry = this._concepts.get(c) || { freq: 0, users: new Set(), lastSeen: 0 };
      entry.freq++;
      entry.users.add(String(handle));
      entry.lastSeen = Date.now();
      this._concepts.set(c, entry);
    }

    // Strengthen co-occurrence links
    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const key = [concepts[i], concepts[j]].sort().join('|');
        this._links.set(key, (this._links.get(key) || 0) + importanceHint * 0.1);
      }
    }

    // Store episode
    const episode = {
      id        : `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      handle    : String(handle),
      nick,
      text      : text.slice(0, 200),
      concepts,
      importance: Math.min(1.0, importanceHint),
      ts        : Date.now(),
      room,
    };
    this._episodes.push(episode);

    // Prune if over limit
    if (this._episodes.length > MAX_EPISODES) {
      // Remove lowest decayed-importance episodes
      this._episodes.sort((a, b) =>
        decayScore(b.importance, Date.now() - b.ts) - decayScore(a.importance, Date.now() - a.ts)
      );
      this._episodes = this._episodes.slice(0, MAX_EPISODES);
    }

    // Prune concept graph
    if (this._concepts.size > MAX_CONCEPTS) {
      const sorted = [...this._concepts.entries()].sort((a, b) => b[1].freq - a[1].freq);
      this._concepts = new Map(sorted.slice(0, MAX_CONCEPTS));
    }

    this._dirty = true;
    this._scheduleSave();
  }

  // ── Retrieve relevant episodes ──────────────────────────────────────────────

  /**
   * Given current message text and optional handle, return up to `limit`
   * past episodes that are conceptually relevant.
   */
  retrieve(text, handle = null, limit = 4) {
    const queryConcepts = new Set(extractConcepts(text));
    if (!queryConcepts.size) return [];

    const scored = this._episodes.map(ep => {
      // Concept overlap score (Jaccard-ish)
      const shared = ep.concepts.filter(c => queryConcepts.has(c)).length;
      if (!shared) return null;

      const conceptScore   = shared / (ep.concepts.length + queryConcepts.size - shared);
      const recencyScore   = decayScore(ep.importance, Date.now() - ep.ts);
      const sameUserBoost  = handle && ep.handle === String(handle) ? 0.2 : 0;
      const score          = conceptScore * 0.6 + recencyScore * 0.3 + sameUserBoost;

      return score >= MIN_RELEVANCE ? { ep, score } : null;
    }).filter(Boolean);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ ep }) => ({
      nick  : ep.nick,
      text  : ep.text,
      room  : ep.room,
      ts    : ep.ts,
    }));
  }

  /**
   * Get the most recent/important stored moments for a specific user handle.
   */
  getUserEpisodes(handle, limit = 5) {
    const h = String(handle);
    const matching = this._episodes
      .filter(ep => ep.handle === h)
      .map(ep => ({ ep, score: decayScore(ep.importance, Date.now() - ep.ts) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return matching.map(({ ep }) => ({ nick: ep.nick, text: ep.text, room: ep.room, ts: ep.ts }));
  }

  /**
   * Find users who share a concept with the given handle —
   * useful for "X and Y both talk about dark aesthetics" type reads.
   */
  getCrossUserPattern(concept) {
    const entry = this._concepts.get(concept.toLowerCase());
    if (!entry || entry.users.size < 2) return null;
    const users = [...entry.users];
    return `[Pattern: ${users.slice(0, 3).join(' + ')} all gravitate to "${concept}"]`;
  }

  /**
   * Get a formatted context hint for LLM injection.
   * Returns null if nothing relevant found.
   */
  getContextHint(text, handle = null) {
    const episodes = this.retrieve(text, handle, 3);
    if (!episodes.length) return null;

    const lines = episodes.map(ep => {
      const ago = _relativeTime(ep.ts);
      return `${ep.nick} (${ago}): "${ep.text.slice(0, 100)}"`;
    });

    return `[Associative recall:\n${lines.join('\n')}]`;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _load() {
    try {
      if (!fs.existsSync(AMN_FILE)) return;
      const data = JSON.parse(fs.readFileSync(AMN_FILE, 'utf8'));
      if (Array.isArray(data.episodes)) this._episodes = data.episodes;
      if (data.concepts) {
        for (const [k, v] of Object.entries(data.concepts)) {
          this._concepts.set(k, { ...v, users: new Set(v.users || []) });
        }
      }
      if (data.links) {
        for (const [k, v] of Object.entries(data.links)) this._links.set(k, v);
      }
    } catch { /* fresh start if corrupt */ }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (!this._dirty) return;
      this._dirty = false;
      try {
        const payload = {
          episodes: this._episodes,
          concepts: Object.fromEntries(
            [...this._concepts.entries()].map(([k, v]) => [k, { ...v, users: [...v.users] }])
          ),
          links: Object.fromEntries(this._links),
        };
        fs.writeFileSync(AMN_FILE, JSON.stringify(payload));
      } catch { /* non-fatal */ }
    }, 5000);
  }

  destroy() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
  }
}

function _relativeTime(ts) {
  const ms  = Date.now() - ts;
  const min = Math.floor(ms / 60000);
  const hr  = Math.floor(ms / 3600000);
  const day = Math.floor(ms / 86400000);
  if (day > 0) return `${day}d ago`;
  if (hr  > 0) return `${hr}h ago`;
  return `${min}m ago`;
}

module.exports = MaraAssociativeMemory;
