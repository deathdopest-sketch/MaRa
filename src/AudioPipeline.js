'use strict';

// she hears what they say, not just what they type.
// buffers raw PCM chunks, skips silence, runs whisper, emits transcripts.

const { EventEmitter } = require('events');
const path = require('path');
const fs   = require('fs');

// energy threshold — below this the chunk is silence, skip it
// browser-side already normalizes and gates at 0.0003 peak; this is a final safety net
const SILENCE_THRESHOLD = 0.00005;

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

    // Serialize — whisper is synchronous and we don't want pile-ups
    this._queue = this._queue.then(async () => {
      try {
        const result = await this._transcriber(f32, {
          sampling_rate: sampleRate,
          return_timestamps: false,
          language: 'english',
          task: 'transcribe',
        });

        const text = (result.text || '')
          .trim()
          .replace(/^\[(BLANK_AUDIO|Music|Applause|Laughter|Silence)\]$/i, '')
          .replace(/^(Thanks for watching!?|Thank you\.?|Subscribe\.?)$/i, '')
          .trim();

        if (text && text.length > 3) {
          this.emit('transcript', { room, trackId, handle, nick, text });
        }
      } catch (_) {}
    });
  }
}

module.exports = AudioPipeline;
