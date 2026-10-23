'use strict';

// she hears what they say, not just what they type.
// buffers raw PCM chunks, skips silence, runs whisper, emits transcripts.

const { EventEmitter } = require('events');
const path = require('path');
const fs   = require('fs');

// energy threshold — below this the chunk is silence, skip it
// browser-side already normalizes and gates at 0.0003 peak; this is a final safety net
const SILENCE_THRESHOLD = 0.00005;

// ── Speech vs. music/media detector ──────────────────────────────────────────
// Returns false when the audio looks like sustained media (music, movies, BGM)
// rather than speech. Uses two cheap features:
//
//   1. Energy CV (coefficient of variation over 40ms frames):
//      Speech is choppy — words and pauses create high energy variance (CV ≥ 0.30).
//      Music/movies are mixed and mastered to be continuous — low CV + very few
//      silent frames is the primary signature.
//
//   2. Zero-crossing rate:
//      Catches pure static/noise: extremely high ZCR with steady energy.
//
// Deliberately conservative — only blocks the clearest cases. Better to let a
// borderline chunk through to Whisper (which will output garbage we can filter
// post-transcription) than to drop real speech.
function _likelySpeech(f32, sampleRate) {
  const frameSize = Math.round(sampleRate * 0.04);  // 40ms analysis windows
  const frames    = Math.floor(f32.length / frameSize);
  if (frames < 6) return true;

  const energies = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const off = i * frameSize;
    for (let j = 0; j < frameSize; j++) sum += f32[off + j] ** 2;
    energies[i] = Math.sqrt(sum / frameSize);
  }

  const maxE   = Math.max(...energies);
  const floor  = maxE * 0.10;
  const active = [];
  let   silent = 0;
  for (let i = 0; i < frames; i++) {
    if (energies[i] > floor) active.push(energies[i]);
    else silent++;
  }
  if (active.length < 4) return true;  // mostly silence — energy gate handles it

  const activeFrac = active.length / frames;
  const mean = active.reduce((s, v) => s + v, 0) / active.length;
  const std  = Math.sqrt(active.reduce((s, v) => s + (v - mean) ** 2, 0) / active.length);
  const cv   = mean > 0 ? std / mean : 0;

  // Music/movie: very steady energy + almost no silent frames
  if (cv < 0.25 && activeFrac > 0.82) return false;
  if (cv < 0.35 && activeFrac > 0.90) return false;

  // Static/noise: extremely high zero-crossing rate + steady energy
  let zc = 0;
  for (let i = 1; i < f32.length; i++) {
    if ((f32[i] >= 0) !== (f32[i - 1] >= 0)) zc++;
  }
  const zcrPerSec = zc / (f32.length / sampleRate);
  if (zcrPerSec > 6000 && cv < 0.5) return false;

  return true;
}

// Whisper often outputs these when transcribing music, noise, or silence.
// Check after stripping bracket markers.
const HALLUC_RX = /^(thank(?:s| you)[\s!.]*|thanks for watching[\s!.]*|(?:please )?subscribe[\s!.]*|like and subscribe[\s!.]*|you[\s!.]*|okay[\s.]*|ok[\s.]*|bye[\s!.]*|goodbye[\s!.]*|[hH]+[mM]+[\s.]*|[uU]+[hH]?[\s.]*|yeah[\s.]*|yes[\s.]*|no[\s.]*|[.,!?\s]+)$/i;

class AudioPipeline extends EventEmitter {
  constructor(dataDir) {
    super();
    this._dataDir     = dataDir;
    this._transcriber = null;
    this._ready       = false;
    this._queue       = Promise.resolve(); // serialize transcription jobs
  }

  get ready() { return this._ready; }

  async init() {
    let transformers;
    try {
      transformers = require('@xenova/transformers');
    } catch (_) {
      console.warn('[Audio] @xenova/transformers not installed.');
      console.warn('[Audio] Run: npm install @xenova/transformers');
      console.warn('[Audio] Audio transcription disabled — text chat still works.');
      return;
    }

    const { pipeline, env } = transformers;

    const modelDir = path.join(this._dataDir, 'models');
    fs.mkdirSync(modelDir, { recursive: true });
    env.cacheDir = modelDir;

    // base.en is a meaningful quality jump over tiny.en — worth the extra 75MB
    const model = process.env.WHISPER_MODEL || 'Xenova/whisper-base.en';
    console.log(`[Audio] Loading ${model} (first run downloads the model)...`);

    try {
      const _seen = new Set();
      this._transcriber = await pipeline('automatic-speech-recognition', model, {
        quantized: true,
        progress_callback: (p) => {
          if ((p.status === 'initiate' || p.status === 'download') && p.file && !_seen.has(p.file)) {
            _seen.add(p.file);
            console.log(`[Audio] Fetching ${p.file}...`);
          }
          if (p.status === 'done' && p.file) {
            const kb = p.loaded ? ` (${Math.round(p.loaded / 1024)}KB)` : '';
            console.log(`[Audio] ✓ ${p.file}${kb}`);
          }
        },
      });
      this._ready = true;
      console.log('[Audio] Whisper ready — room audio transcription active.');
    } catch (e) {
      console.warn('[Audio] Whisper failed to load:', e.message);
    }
  }

  // Called by StumbleChatAdapter when a PCM chunk arrives from the browser.
  receiveChunk(room, trackId, b64, sampleRate = 16000, handle = null, nick = null) {
    if (!this._ready) return;

    // Decode base64 Int16 → Float32
    const raw   = Buffer.from(b64, 'base64');
    const int16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    const f32   = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768.0;

    // RMS energy check — skip silence
    let energy = 0;
    for (let i = 0; i < f32.length; i++) energy += f32[i] * f32[i];
    if (energy / f32.length < SILENCE_THRESHOLD) return;

    // Speech detector — skip music, movies, and static before Whisper sees them
    if (!_likelySpeech(f32, sampleRate)) {
      if (process.env.DEBUG_AUDIO) console.log(`[Audio] dropped non-speech chunk (${nick || handle || '?'})`);
      return;
    }

    // Serialize — whisper is synchronous and we don't want pile-ups
    this._queue = this._queue.then(async () => {
      try {
        const result = await this._transcriber(f32, {
          sampling_rate: sampleRate,
          return_timestamps: false,
          language: 'english',
          task: 'transcribe',
        });

        // Strip Whisper's non-speech markers and musical notation
        let text = (result.text || '').trim();
        text = text
          .replace(/\[(BLANK_AUDIO|Music|Applause|Laughter|Silence|noise)\]/gi, '')
          .replace(/♪[^♪]*♪?/g, '')
          .replace(/🎵[^🎵]*🎵?/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

        // Drop known Whisper hallucinations (common outputs on music/noise)
        if (HALLUC_RX.test(text)) return;

        if (text && text.length > 3) {
          this.emit('transcript', { room, trackId, handle, nick, text });
        }
      } catch (_) {}
    });
  }
}

module.exports = AudioPipeline;
