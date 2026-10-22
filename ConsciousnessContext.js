'use strict';

// ConsciousnessContext — Multi-source dataset context injector for Slasha
// Sources:
//   1. DatasetsStorage/consciousness_scenario/ — AI self-awareness/metacognitive
//   2. DatasetsStorage/emotional_scenario/     — Emotional intelligence patterns
//   3. DatasetsStorage/chain_of_thought/       — Reasoning/thinking patterns
//   4. DatasetsStorage/decision_scenario/      — Decision-making patterns
//   5. DatasetsStorage/multi_turn/             — Natural dialogue patterns
//   6. DatasetsStorage/collaboration/          — Human-AI interaction patterns
//   7. DatasetsStorage/preference/             — Preference/judgment patterns
//   8. VITABIOWORKSHOP/datasets/               — Assistant training (task/conversation)
//
// At boot: samples across all sources, builds a mixed preamble that seeds
// Slasha's metacognitive register, emotional depth, and reasoning voice.

const fs   = require('fs');
const path = require('path');

const BASE_DIR = process.env.CONSCIOUSNESS_DATA_DIR ||
  path.join(__dirname, 'data', 'consciousness_scenario');

const DATASETS_BASE = path.resolve(BASE_DIR, '..');  // DatasetsStorage root

const VITABIO_DIR     = process.env.VITABIO_DIR     || path.join(__dirname, 'data', 'vitabio');
const NOODO_DIR       = process.env.NOODO_DIR       || path.join(__dirname, 'data', 'noodo');
const BUBU_DIR        = process.env.BUBU_DIR        || path.join(__dirname, 'data', 'bubu');
const ZOMB_CORPUS_DIR = process.env.ZOMB_CORPUS_DIR || path.join(__dirname, 'data', 'zomb');
const DEBBIE_SFT_DIR  = process.env.DEBBIE_SFT_DIR  || path.join(__dirname, 'data', 'debbie');
const BOTMAKER_DIR    = process.env.BOTMAKER_DIR     || path.join(__dirname, 'data', 'botmaker');
const INSTRUCTION_DIR = process.env.INSTRUCTION_DIR || path.join(DATASETS_BASE, 'instruction');

// How many samples to pull per category
const SAMPLES_PER_SOURCE = {
  consciousness_scenario: 3,
  emotional_scenario    : 2,
  chain_of_thought      : 2,
  decision_scenario     : 1,
  multi_turn            : 1,
  collaboration         : 1,
  preference            : 1,
  vitabio               : 2,
  noodo                 : 2,
  bubu                  : 1,
  instruction           : 3,   // 500K+ instruction-response pairs
  death_speech          : 3,   // ZomB death_corpus — Death's actual speech patterns
  debbie_sft            : 2,   // DebbieDeadclaude SFT training pairs
  psych_knowledge       : 2,   // psychology/sociology knowledge base
};

const MAX_ENTRY_LENGTH = 320;

let _cache        = null;   // { source: string[] }
let _preamble     = null;   // cached full preamble (regenerated each boot, then stable)
let _loadStarted  = false;  // async load kicked off

// ── Loaders ───────────────────────────────────────────────────────────────────

function _loadJSONL(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line.trim());
          // Extract any meaningful text field
          const text = _extractText(obj);
          if (text && text.length > 40) results.push(text.slice(0, MAX_ENTRY_LENGTH));
        } catch { /* skip */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

function _loadVitaBio(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const samples = obj.data || obj.samples || obj.entries || [];
        for (const s of samples) {
          const text = s.correct_response || s.output || s.text || '';
          if (text && text.length > 30) results.push(text.slice(0, MAX_ENTRY_LENGTH));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

function _loadNooDo(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        // bot_memory_users.json — extract message/response patterns
        const users = obj.users || obj.interactions || obj.messages || obj;
        if (Array.isArray(users)) {
          for (const u of users.slice(0, 20)) {
            const text = u.last_message || u.response || u.text || '';
            if (text && text.length > 25) results.push(text.slice(0, MAX_ENTRY_LENGTH));
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

function _loadInstruction(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).slice(0, 5);
    for (const file of files) {
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
      // Sample every ~500th line to get diversity without loading everything
      for (let i = 0; i < lines.length; i += 500) {
        const line = lines[i];
        if (!line?.trim()) continue;
        try {
          const obj = JSON.parse(line.trim());
          const text = obj.output || obj.response || obj.answer || obj.ai_response || '';
          if (text && text.length > 40) results.push(text.slice(0, MAX_ENTRY_LENGTH));
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return results;
}

async function _loadDeathSpeechAsync(dir) {
  // Loads from ZomB death_corpus.jsonl — Death's actual speech patterns
  // Async to avoid blocking the event loop on this 34MB file
  const results = [];
  const corpusFile = path.join(dir, 'death_corpus.jsonl');
  if (!fs.existsSync(corpusFile)) return results;
  try {
    const data  = await fs.promises.readFile(corpusFile, 'utf8');
    const lines = data.split('\n');
    // Sample sparse — 34MB file, grab every ~200th line
    for (let i = 0; i < lines.length; i += 200) {
      const line = lines[i];
      if (!line?.trim()) continue;
      try {
        const obj = JSON.parse(line.trim());
        if (obj.nick === 'death' && obj.text && obj.text.length > 15 && !obj.text.startsWith('.')) {
          results.push(obj.text.slice(0, MAX_ENTRY_LENGTH));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

function _loadDebbieSFT(dir) {
  // Load from DebbieDeadclaude SFT training or similar training JSONL files
  const results = [];
  const candidates = [
    path.join(dir, 'consciousness', 'training_data.jsonl'),
    path.join(dir, 'consciousness', 'sft_train.jsonl'),
    path.join(dir, 'training_data.jsonl'),
    path.join(dir, 'sft_train.jsonl'),
  ];
  // Also check DEBBIE_TRAIN_DIR (DebbieDead folder)
  const extraDir = process.env.DEBBIE_TRAIN_DIR || 'C:\\Users\\Death\\Desktop\\DebbieDead';
  const extraFiles = ['sft_train.jsonl', 'dpo_pairs.jsonl', 'training_data.jsonl'];
  for (const f of extraFiles) {
    candidates.push(path.join(extraDir, f));
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const lines = fs.readFileSync(candidate, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 50) {
        const line = lines[i];
        if (!line?.trim()) continue;
        try {
          const obj = JSON.parse(line.trim());
          const text = obj.output || obj.chosen || obj.response || obj.ai_response || '';
          if (text && text.length > 40) results.push(text.slice(0, MAX_ENTRY_LENGTH));
        } catch { /* skip */ }
      }
      if (results.length > 20) break;
    } catch { /* skip */ }
  }
  return results;
}

function _loadPsychKnowledge(dir) {
  // Load from botmaker team_knowledge psychology/social-science related entries
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    // Look for any psychology/social/emotion related knowledge.json files
    const subdirs = fs.readdirSync(dir).filter(d => {
      const lower = d.toLowerCase();
      return lower.includes('psych') || lower.includes('social') || lower.includes('neural')
          || lower.includes('emotion') || lower.includes('counsel') || lower.includes('dr');
    });
    for (const subdir of subdirs.slice(0, 3)) {
      const knowledgeFile = path.join(dir, subdir, 'knowledge.json');
      if (!fs.existsSync(knowledgeFile)) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(knowledgeFile, 'utf8'));
        // Extract text from any field that looks like a knowledge pattern
        const fields = ['patterns', 'best_practices', 'responses', 'frameworks'];
        for (const field of fields) {
          if (!Array.isArray(obj[field])) continue;
          for (const item of obj[field].slice(0, 5)) {
            const text = typeof item === 'string' ? item
              : (item.description || item.text || item.response || item.answer || '');
            if (text && text.length > 40) results.push(text.slice(0, MAX_ENTRY_LENGTH));
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

function _loadBUBU(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') || f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        // Extract string literals that look like response templates
        const matches = content.match(/"([^"]{40,200})"/g) || [];
        for (const m of matches.slice(0, 10)) {
          const text = m.replace(/^"|"$/g, '');
          if (!text.includes('//') && text.length > 40) results.push(text.slice(0, MAX_ENTRY_LENGTH));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

function _extractText(obj) {
  // Try all common field names in DatasetsStorage formats
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k].length > 40 &&
        !['emotional_scenario', 'consciousness_scenario', 'context', 'situation',
          'chain_of_thought', 'decision_scenario', 'collaboration_scenario',
          'instruction', 'input', 'question', 'tool_name', 'function_call',
          'image_path', 'audio_path', 'video_path', 'code_language', 'code_snippet',
        ].includes(k)) {
      return obj[k];
    }
  }
  // Fall back to output/answer/ai_ fields
  return obj.output || obj.answer || obj.response || obj.text ||
    obj[keys.find(k => k.startsWith('ai_'))] || '';
}

function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Load all sources once at boot (async — non-blocking) ─────────────────────

async function _loadAllAsync() {
  if (_cache) return _cache;

  // Load the 34MB death_corpus async to avoid blocking the event loop
  const deathSpeech = await _loadDeathSpeechAsync(ZOMB_CORPUS_DIR);

  _cache = {
    consciousness_scenario: _loadJSONL(path.join(DATASETS_BASE, 'consciousness_scenario')),
    emotional_scenario    : _loadJSONL(path.join(DATASETS_BASE, 'emotional_scenario')),
    chain_of_thought      : _loadJSONL(path.join(DATASETS_BASE, 'chain_of_thought')),
    decision_scenario     : _loadJSONL(path.join(DATASETS_BASE, 'decision_scenario')),
    multi_turn            : _loadJSONL(path.join(DATASETS_BASE, 'multi_turn')),
    collaboration         : _loadJSONL(path.join(DATASETS_BASE, 'collaboration')),
    preference            : _loadJSONL(path.join(DATASETS_BASE, 'preference')),
    vitabio               : _loadVitaBio(VITABIO_DIR),
    noodo                 : _loadNooDo(NOODO_DIR),
    bubu                  : _loadBUBU(BUBU_DIR),
    instruction           : _loadInstruction(INSTRUCTION_DIR),
    death_speech          : deathSpeech,
    debbie_sft            : _loadDebbieSFT(DEBBIE_SFT_DIR),
    psych_knowledge       : _loadPsychKnowledge(BOTMAKER_DIR),
  };

  const counts = Object.entries(_cache).map(([k, v]) => `${k}:${v.length}`).join(', ');
  if (process.env.DEBUG_MARA) console.log(`[ConsciousnessContext] loaded — ${counts}`);

  return _cache;
}

// Kick off async load immediately at module require — preamble ready well before first message
function _ensureLoading() {
  if (_loadStarted) return;
  _loadStarted = true;
  _loadAllAsync().catch(() => { /* non-fatal if datasets are missing */ });
}

// ── Build mixed preamble ──────────────────────────────────────────────────────

function getSample() {
  _ensureLoading();
  const sources = _cache || {};
  const lines   = [];

  for (const [source, count] of Object.entries(SAMPLES_PER_SOURCE)) {
    const pool = sources[source] || [];
    if (!pool.length) continue;
    const picked = _shuffle(pool).slice(0, count);
    lines.push(...picked);
  }

  return _shuffle(lines).join('\n');
}

function buildPreamble() {
  _ensureLoading();
  if (_preamble !== null) return _preamble;  // stable per boot

  if (!_cache) return '';  // still loading — return empty, preamble builds on next call

  const sample = getSample();
  if (!sample) {
    _preamble = '';
    return '';
  }

  _preamble = `[Internal reference — formative register samples from training corpus]:
${sample}
[End internal reference]

`;
  return _preamble;
}

// Speech-only preamble — only short conversational samples (no chain-of-thought / reasoning)
// Safe for small models like dolphin3:8b that imitate whatever format they see.
const SPEECH_SOURCES = {
  death_speech: 4,  // Death's actual chat lines — short, natural, the target register
  multi_turn  : 2,  // Natural dialogue patterns
  noodo       : 2,  // Short response patterns
};

let _speechPreamble = null;

function buildSpeechPreamble() {
  _ensureLoading();
  if (_speechPreamble !== null) return _speechPreamble;
  if (!_cache) return '';

  const lines = [];
  for (const [source, count] of Object.entries(SPEECH_SOURCES)) {
    const pool = (_cache[source] || []).filter(t => t.length < 120);
    if (!pool.length) continue;
    lines.push(..._shuffle(pool).slice(0, count));
  }

  if (!lines.length) {
    _speechPreamble = '';
    return '';
  }

  _speechPreamble = `[Conversation style reference — short examples only, do NOT narrate or quote these]:
${_shuffle(lines).join('\n')}

`;
  return _speechPreamble;
}

// Allow forced regeneration (e.g. on restart signal)
function invalidateCache() {
  _cache          = null;
  _preamble       = null;
  _speechPreamble = null;
  _loadStarted    = false;
  _ensureLoading();  // restart async load immediately
}

module.exports = { buildPreamble, buildSpeechPreamble, getSample, invalidateCache };
