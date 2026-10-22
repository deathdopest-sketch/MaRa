'use strict';

const fs   = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────
const D                    = 768;
const MAX_ARTIFACTS        = 500;
const FIDELITY_WARN_RATIO  = 0.15;   // N/D warn  → N > ~115
const FIDELITY_SHARD_RATIO = 0.25;   // N/D shard → N > ~192
const FAST_BEAT_MS         = 60_000;
const SLOW_BEAT_MS         = 5 * 60_000;
const CODEBOOK_SEED        = 0xDEADC0DE;
const EMBED_CACHE_SIZE     = 64;
const STORE_PATH   = path.join(__dirname, 'data', 'MaraMemory', 'hms_store.json');
const ANCHORS_PATH = path.join(__dirname, 'data', 'MaraMemory', 'hms_anchors.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function _lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s; };
}

function _genVec(seed) {
  const rng = _lcg(seed);
  const v = new Float32Array(D);
  for (let i = 0; i < D; i++) v[i] = (rng() & 1) ? 1.0 : -1.0;
  return v;
}

function _cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < D; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function _hashStr(s) {
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function _nanoid8() {
  const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let id = '';
  for (let i = 0; i < 8; i++) id += C[Math.floor(Math.random() * 64)];
  return id;
}

// ── HMS ───────────────────────────────────────────────────────────────────────

class MaraHolographicMemory {
  constructor(ollama, logger) {
    this.ollama  = ollama;
    this.log     = logger;
    this._shards = [];
    this._dirty  = false;
    this._fallback = null;

    this._embedCache    = [];
    this._embedCacheIdx = 0;

    this._axisCentroids  = {};
    this._anchorsLoaded  = false;

    this._shards.push({ hologram: new Float32Array(D), artifacts: [] });
    this._load();

    this._fastTimer = setInterval(() => this._fastBeat(), FAST_BEAT_MS);
    this._slowTimer = setInterval(() => this._slowBeat(), SLOW_BEAT_MS);

    this._scheduleAnchors();
  }

  // ── Codebook ────────────────────────────────────────────────────────────────

  _axisVec(axisName) {
    return _genVec(_hashStr('axis:' + axisName) ^ CODEBOOK_SEED);
  }

  // ── Permutation binding ─────────────────────────────────────────────────────

  _permFromEmbedding(emb) {
    const perm = new Uint16Array(D);
    for (let i = 0; i < D; i++) perm[i] = i;
    let seed = CODEBOOK_SEED;
    for (let i = 0; i < D; i++) seed ^= (emb[i] < 0 ? 1 : 0) << (i & 31);
    const rng = _lcg(seed);
    for (let i = D - 1; i > 0; i--) {
      const j = rng() % (i + 1);
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    return perm;
  }

  _bind(axisVec, perm) {
    const out = new Float32Array(D);
    for (let i = 0; i < D; i++) out[i] = axisVec[perm[i]];
    return out;
  }

  _unbind(hologram, perm) {
    const inv = new Uint16Array(D);
    for (let i = 0; i < D; i++) inv[perm[i]] = i;
    const out = new Float32Array(D);
    for (let i = 0; i < D; i++) out[i] = hologram[inv[i]];
    return out;
  }

  // ── Embed cache ─────────────────────────────────────────────────────────────

  async _embed(text) {
    if (!this.ollama?.available) throw new Error('Ollama not available');
    const key = text.slice(0, 200);
    const hit = this._embedCache.find(e => e.key === key);
    if (hit) return hit.emb;

    const raw = await this.ollama.embed(text);
    const emb = raw instanceof Float32Array ? raw : new Float32Array(raw);

    if (this._embedCache.length < EMBED_CACHE_SIZE) {
      this._embedCache.push({ key, emb });
    } else {
      this._embedCache[this._embedCacheIdx] = { key, emb };
      this._embedCacheIdx = (this._embedCacheIdx + 1) % EMBED_CACHE_SIZE;
    }
    return emb;
  }

  // ── Axis scoring ─────────────────────────────────────────────────────────────

  _axisScore(emb, axisName) {
    const centroid = this._axisCentroids[axisName];
    if (!centroid) return 0;
    return Math.max(0, _cosineSim(emb, centroid));
  }

  _scheduleAnchors(attempt = 0) {
    // Defer anchor embedding until Ollama is actually available.
    // createMara() runs before checkAvailable() so we must not fire embed
    // requests at startup — they block Ollama's queue for 15s each × 15 phrases.
    const delay = attempt === 0 ? 20_000 : 60_000;   // first retry 20s, then 60s
    setTimeout(() => {
      if (!this.ollama?.available) {
        if (attempt < 5) this._scheduleAnchors(attempt + 1);
        return;
      }
      this._initAnchors().catch(err => this.log?.warn('[HMS] anchor init failed:', err.message));
    }, delay);
  }

  async _initAnchors() {
    if (!fs.existsSync(ANCHORS_PATH)) {
      this.log?.warn('[HMS] hms_anchors.json not found — axis scoring disabled');
      return;
    }
    const raw = JSON.parse(fs.readFileSync(ANCHORS_PATH, 'utf8'));
    for (const [axis, phrases] of Object.entries(raw)) {
      const vecs = [];
      for (const phrase of phrases) {
        try {
          vecs.push(await this._embed(phrase));
        } catch { /* skip failed anchor */ }
      }
      if (!vecs.length) continue;
      const centroid = new Float32Array(D);
      for (const v of vecs) for (let i = 0; i < D; i++) centroid[i] += v[i];
      for (let i = 0; i < D; i++) centroid[i] /= vecs.length;
      this._axisCentroids[axis] = centroid;
    }
    this._anchorsLoaded = true;
    this.log?.info('[HMS] anchors loaded:', Object.keys(this._axisCentroids).join(', '));
  }

  // ── Store ───────────────────────────────────────────────────────────────────

  store(handle, nick, text, room, importance = 0.5) {
    this._storeAsync(handle, nick, text, room, importance).catch(err => {
      this.log?.debug('[HMS] store failed, routing to fallback:', err.message);
      this._getFallback()
        .then(fb => fb?.store?.(handle, nick, text, room, importance))
        .catch(() => {});
    });
  }

  async _storeAsync(handle, nick, text, room, importance) {
    const emb  = await this._embed(text);
    const perm = this._permFromEmbedding(emb);

    const axes = {
      emotional : this._axisScore(emb, 'emotional'),
      historical: this._axisScore(emb, 'historical'),
      growth    : this._axisScore(emb, 'growth'),
    };

    // Weighted superposition across axes
    const boundVec = new Float32Array(D);
    for (const axis of ['emotional', 'historical', 'growth']) {
      const score = axes[axis];
      if (score <= 0) continue;
      const bound = this._bind(this._axisVec(axis), perm);
      for (let i = 0; i < D; i++) boundVec[i] += bound[i] * score;
    }

    const shard = this._shards[this._shards.length - 1];
    for (let i = 0; i < D; i++) shard.hologram[i] += boundVec[i];

    shard.artifacts.push({
      id        : _nanoid8(),
      user      : handle,
      nick      : nick || handle,
      text,
      room      : room || '',
      ts        : Date.now(),
      importance,
      axes,
      embedding : Array.from(emb),
      perm      : Array.from(perm),
    });

    this._dirty = true;

    const ratio = shard.artifacts.length / D;
    if (ratio > FIDELITY_SHARD_RATIO) {
      this._shard();
    } else if (ratio > FIDELITY_WARN_RATIO) {
      this.log?.warn(`[HMS] fidelity warning — N=${shard.artifacts.length} N/D=${ratio.toFixed(3)}`);
    }
  }

  // ── Shard ────────────────────────────────────────────────────────────────────

  _shard() {
    const shard = this._shards[this._shards.length - 1];
    if (shard.artifacts.length < 4) return;

    const sorted = [...shard.artifacts].sort((a, b) => a.ts - b.ts);
    const mid    = Math.floor(sorted.length / 2);

    const _rebuild = (arts) => {
      const h = new Float32Array(D);
      for (const art of arts) {
        const emb  = new Float32Array(art.embedding);
        const perm = new Uint16Array(art.perm);
        for (const axis of ['emotional', 'historical', 'growth']) {
          const score = art.axes?.[axis] || 0;
          if (score <= 0) continue;
          const bound = this._bind(this._axisVec(axis), perm);
          for (let i = 0; i < D; i++) h[i] += bound[i] * score;
        }
      }
      return { hologram: h, artifacts: arts };
    };

    this._shards[this._shards.length - 1] = _rebuild(sorted.slice(0, mid));
    this._shards.push(_rebuild(sorted.slice(mid)));

    const n0 = sorted.slice(0, mid).length;
    const n1 = sorted.slice(mid).length;
    this.log?.info(`[HMS] sharded → ${this._shards.length} shards (${n0}+${n1})`);
    this._dirty = true;
  }

  // ── Retrieve ─────────────────────────────────────────────────────────────────

  async retrieve(query, topK = 5) {
    let emb;
    try {
      emb = await this._embed(query);
    } catch (err) {
      this.log?.debug('[HMS] retrieve embed failed:', err.message);
      const fb = await this._getFallback();
      return fb?.retrieve?.(query, topK) ?? [];
    }

    const perm   = this._permFromEmbedding(emb);
    const scored = [];

    for (const shard of this._shards) {
      const candidate = this._unbind(shard.hologram, perm);
      const holoScore = Math.max(0, _cosineSim(candidate, emb));

      for (const art of shard.artifacts) {
        const directScore = Math.max(0, _cosineSim(new Float32Array(art.embedding), emb));
        scored.push({ art, score: 0.6 * holoScore + 0.4 * directScore });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => ({ ...s.art, score: s.score }));
  }

  // ── Context hint ─────────────────────────────────────────────────────────────

  async getContextHint(query, user) {
    try {
      const results = await this.retrieve(query, 3);
      if (!results.length) return '';

      const top        = results[0];
      const axisTop    = Object.entries(top.axes || {}).sort((a, b) => b[1] - a[1])[0];
      const axisLabel  = axisTop ? `${axisTop[0]}(${axisTop[1].toFixed(2)})` : '';

      const parts = [`[memory] ${top.nick || top.user} said: '${top.text.slice(0, 80)}'`];
      if (axisLabel) parts.push(`axis: ${axisLabel}`);
      if (results[1]) parts.push(`also: '${results[1].text.slice(0, 50)}'`);
      return parts.join(' | ');
    } catch (err) {
      this.log?.debug('[HMS] getContextHint error:', err.message);
      const fb = await this._getFallback();
      return fb ? (fb.getContextHint?.(query, user) ?? '') : '';
    }
  }

  // ── Fallback ─────────────────────────────────────────────────────────────────

  async _getFallback() {
    if (!this._fallback) {
      try {
        const MaraAssociativeMemory = require('./MaraAssociativeMemory');
        this._fallback = new MaraAssociativeMemory(this.log);
      } catch { return null; }
    }
    return this._fallback;
  }

  // ── Heartbeats ────────────────────────────────────────────────────────────────

  _fastBeat() {
    let changed = false;
    for (const shard of this._shards) {
      for (const art of shard.artifacts) {
        art.importance = Math.max(0, (art.importance ?? 0.5) - 0.001);
      }
      if (shard.artifacts.length > MAX_ARTIFACTS) {
        shard.artifacts.sort((a, b) => (a.importance ?? 0) - (b.importance ?? 0));
        shard.artifacts.splice(0, shard.artifacts.length - MAX_ARTIFACTS);
        changed = true;
      }
    }
    if (changed) this._dirty = true;
  }

  _slowBeat() {
    const total = this._shards.reduce((n, s) => n + s.artifacts.length, 0);
    const ratio = total / D;
    this.log?.info(`[HMS] fidelity — N=${total} N/D=${ratio.toFixed(3)} shards=${this._shards.length}`);
    if (this._dirty) this._save();
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  _load() {
    try {
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (raw.version !== 2) { this.log?.warn('[HMS] store version mismatch — starting fresh'); return; }
      this._shards = raw.shards.map(s => ({
        hologram : new Float32Array(s.hologram),
        artifacts: s.artifacts,
      }));
      const total = this._shards.reduce((n, s) => n + s.artifacts.length, 0);
      this.log?.info(`[HMS] loaded ${total} artifacts across ${this._shards.length} shards`);
    } catch (err) {
      this.log?.warn('[HMS] load failed:', err.message);
    }
  }

  _save() {
    try {
      const data = {
        version: 2,
        shards : this._shards.map(s => ({
          hologram : Array.from(s.hologram),
          artifacts: s.artifacts,
        })),
      };
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(data), 'utf8');
      this._dirty = false;
    } catch (err) {
      this.log?.warn('[HMS] save failed:', err.message);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  destroy() {
    clearInterval(this._fastTimer);
    clearInterval(this._slowTimer);
    if (this._dirty) this._save();
    this._fallback?.destroy?.();
  }
}

module.exports = MaraHolographicMemory;
