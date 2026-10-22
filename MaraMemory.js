'use strict';

// MaraMemory — per-user dossier system
// Based on LillyMemory + Demonika's relationship tracking / user profiling
// Indexed by handle (stable) not nick (changes)

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(
  process.env.MARA_DATA_DIR || path.join(__dirname, 'data'),
  'MaraMemory'
);
const DOSSIER_FILE = path.join(DATA_DIR, 'dossiers.json');
const STREAM_FILE  = path.join(DATA_DIR, 'interaction_stream.json');

const TRUST_LEVELS = { unknown: 0, neutral: 1, familiar: 2, trusted: 3, owner: 10 };

class MaraMemory {
  constructor(logger) {
    this.log = logger;
    this._dossiers  = new Map(); // handle → profile
    this._stream    = [];        // last N interactions across all users
    this._maxStream = 200;
    this._dirty     = false;
    this._saveTimer = null;
    this._ensureDir();
    this._load();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  getProfile(handle) {
    return this._dossiers.get(String(handle)) || null;
  }

  upsert(handle, nick, roomName) {
    const key = String(handle);
    if (!this._dossiers.has(key)) {
      this._dossiers.set(key, {
        handle: key,
        nick,
        aliases: [nick],
        room: roomName,
        trustLevel: 0,
        isOwner: false,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        interactionCount: 0,
        manipulationFlags: [],
        notes: [],
        mood_reads: [],
        relationship: 'stranger',
      });
    } else {
      const p = this._dossiers.get(key);
      p.lastSeen = Date.now();
      if (nick && !p.aliases.includes(nick)) p.aliases.push(nick);
      p.nick = nick;
      p.room = roomName;
    }
    this._scheduleSave();
    return this._dossiers.get(key);
  }

  recordInteraction(handle, nick, text, nnnResult) {
    const key = String(handle);
    const profile = this.upsert(handle, nick, null);
    profile.interactionCount++;
    profile.lastSeen = Date.now();

    // Track mood read
    if (nnnResult) {
      const read = {
        ts: Date.now(),
        contextType: nnnResult.contextType,
        flirt: nnnResult.flirtMode,
        tech: nnnResult.techMode,
        manip: nnnResult.manipDetected,
        score: nnnResult.score,
      };
      profile.mood_reads.push(read);
      if (profile.mood_reads.length > 20) profile.mood_reads.shift();

      // Flag manipulation if detected
      if (nnnResult.manipDetected) {
        const flag = { ts: Date.now(), snippet: text.slice(0, 80) };
        profile.manipulationFlags.push(flag);
        if (profile.manipulationFlags.length > 10) profile.manipulationFlags.shift();
      }
    }

    // Relationship progression
    this._updateRelationship(profile);

    // Global stream
    this._stream.push({ ts: Date.now(), handle: key, nick, text: text.slice(0, 120) });
    if (this._stream.length > this._maxStream) this._stream.shift();

    this._scheduleSave();
  }

  _updateRelationship(profile) {
    if (profile.isOwner) { profile.relationship = 'my person'; return; }
    const n = profile.interactionCount;
    const t = profile.trustLevel;
    if (t >= TRUST_LEVELS.trusted || n >= 50) {
      profile.relationship = 'trusted';
    } else if (n >= 20 || t >= TRUST_LEVELS.familiar) {
      profile.relationship = 'familiar';
    } else if (n >= 5) {
      profile.relationship = 'neutral';
    }
    // below 5 interactions stays 'stranger'
  }

  setTrust(handle, level) {
    const profile = this.getProfile(handle);
    if (!profile) return;
    profile.trustLevel = TRUST_LEVELS[level] ?? level;
    this._scheduleSave();
  }

  setOwner(handle) {
    const profile = this.getProfile(handle);
    if (!profile) return;
    profile.isOwner = true;
    profile.trustLevel = TRUST_LEVELS.owner;
    profile.relationship = 'my person';
    this._scheduleSave();
  }

  addNote(handle, note) {
    const profile = this.getProfile(handle);
    if (!profile) return;
    profile.notes.push({ ts: Date.now(), note });
    if (profile.notes.length > 30) profile.notes.shift();
    this._scheduleSave();
  }

  getRecentStream(n = 20) {
    return this._stream.slice(-n);
  }

  getDossierSummary(handle) {
    const p = this.getProfile(handle);
    if (!p) return null;
    const manipCount = p.manipulationFlags.length;
    const avgScore = p.mood_reads.length
      ? (p.mood_reads.reduce((s, r) => s + r.score, 0) / p.mood_reads.length).toFixed(2)
      : 'n/a';
    return {
      nick: p.nick,
      aliases: p.aliases,
      trustLevel: p.trustLevel,
      isOwner: p.isOwner,
      relationship: p.relationship,
      interactionCount: p.interactionCount,
      manipulationFlags: manipCount,
      avgEngagementScore: avgScore,
      notes: p.notes.slice(-5),
      firstSeen: new Date(p.firstSeen).toISOString(),
      lastSeen: new Date(p.lastSeen).toISOString(),
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _load() {
    try {
      if (fs.existsSync(DOSSIER_FILE)) {
        const raw = JSON.parse(fs.readFileSync(DOSSIER_FILE, 'utf8'));
        for (const [k, v] of Object.entries(raw)) {
          this._dossiers.set(k, v);
        }
        this.log?.info(`[MaraMemory] loaded ${this._dossiers.size} dossiers`);
      }
      if (fs.existsSync(STREAM_FILE)) {
        this._stream = JSON.parse(fs.readFileSync(STREAM_FILE, 'utf8'));
      }
    } catch (err) {
      this.log?.warn(`[MaraMemory] load error: ${err.message}`);
    }
  }

  _save() {
    try {
      const obj = {};
      for (const [k, v] of this._dossiers) obj[k] = v;
      fs.writeFileSync(DOSSIER_FILE, JSON.stringify(obj, null, 2), 'utf8');
      fs.writeFileSync(STREAM_FILE, JSON.stringify(this._stream, null, 2), 'utf8');
    } catch (err) {
      this.log?.warn(`[MaraMemory] save error: ${err.message}`);
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 5000);
  }

  destroy() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._save();
  }
}

module.exports = { MaraMemory };
