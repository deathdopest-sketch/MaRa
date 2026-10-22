'use strict';

// she listens to the room, not just the chat.
// hooks WebRTC audio tracks before StumbleChat creates them.
// attribution: when subscribe fires via WS, we inject the handle into the page
// so the next RTCPeerConnection track event knows who it belongs to.

const { EventEmitter } = require('events');

class AudioCapture extends EventEmitter {
  constructor(roomName, page) {
    super();
    this.roomName = roomName;
    this._page    = page;
    this._active  = false;
  }

  // ── Call BEFORE page.goto() ───────────────────────────────────────────────
  // Injects the full capture pipeline into the page at document-creation time
  // so no RTCPeerConnection or track event is ever missed.

  async preNavigate() {
    await this._page.evaluateOnNewDocument(() => {
      window._maraSubscribeQueue = [];     // FIFO: { handle, nick, ts } — one entry per broadcaster
      window._maraTrackOwners   = {};      // trackId → { handle, nick }
      window._maraAudioNodes    = [];      // keep ctx/src/proc alive — prevents GC
      window._maraChunkQueue    = [];      // buffer chunks until Node callback is ready
      window._maraRTCPeers      = [];

      const CHUNK_S = 3;     // 3-second windows — short enough to catch brief phrases
      const SR      = 16000;

      const sendChunk = (chunk) => {
        // If the Node-side exposeFunction callback is already live, call it directly.
        // Otherwise buffer — start() will flush the queue.
        if (typeof window.__maraAudioChunk === 'function') {
          try { window.__maraAudioChunk(chunk); } catch (_) {}
        } else {
          window._maraChunkQueue.push(chunk);
        }
      };

      const capture = (track, stream, attribution) => {
        try {
          const ctx  = new AudioContext({ sampleRate: SR });
          ctx.resume().catch(() => {});  // force-resume — Chrome suspends without user gesture

          const src  = ctx.createMediaStreamSource(stream);
          // 2 input channels so Chrome properly downmixes stereo WebRTC streams;
          // 1 output channel — we only need mono for Whisper
          const proc = ctx.createScriptProcessor(8192, 2, 1);

          // store strong refs so V8 GC doesn't collect the audio graph
          window._maraAudioNodes.push({ ctx, src, proc, trackId: track.id });

          const owner  = attribution || { handle: null, nick: null };
          window._maraTrackOwners[track.id] = owner;

          let buf    = [];
          const target = SR * CHUNK_S;

          proc.onaudioprocess = (e) => {
            const ch0 = e.inputBuffer.getChannelData(0);
            const ch1 = e.inputBuffer.numberOfChannels > 1
              ? e.inputBuffer.getChannelData(1)
              : null;

            const needed = target - buf.length;
            const take   = Math.min(ch0.length, needed);
            for (let i = 0; i < take; i++) {
              // downmix stereo → mono by averaging both channels
              buf.push(ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i]);
            }
            if (take < ch0.length) {
              flushBuf();
              for (let i = take; i < ch0.length; i++) {
                buf.push(ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i]);
              }
            } else if (buf.length >= target) {
              flushBuf();
            }
          };

          const flushBuf = () => {
            if (buf.length < target) return;
            const slice = buf.splice(0, target);

            // normalize to peak 1.0 so Whisper gets clean signal
            let peak = 0;
            for (let i = 0; i < slice.length; i++) {
              const a = Math.abs(slice[i]);
              if (a > peak) peak = a;
            }
            if (peak < 0.0003) return;  // below noise floor — skip
            const gain = 1.0 / peak;

            // float32 → int16 → base64
            const i16   = new Int16Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
              i16[i] = Math.max(-32768, Math.min(32767, Math.round(slice[i] * gain * 32767)));
            }
            const bytes = new Uint8Array(i16.buffer);
            const SZ    = 8192;
            let b64 = '';
            for (let j = 0; j < bytes.length; j += SZ) {
              b64 += btoa(String.fromCharCode(...bytes.subarray(j, j + SZ)));
            }

            sendChunk({ trackId: track.id, b64, sampleRate: SR, handle: owner.handle, nick: owner.nick });
          };

          src.connect(proc);
          proc.connect(ctx.destination);
          track.addEventListener('ended', () => {
            flushBuf();  // send whatever partial chunk remains when track ends
            try { ctx.close(); } catch (_) {}
            // remove from node list
            window._maraAudioNodes = window._maraAudioNodes.filter(n => n.trackId !== track.id);
          });

        } catch (e) {
          console.warn('[MaRa audio]', e.message);
        }
      };

      // Pop the freshest matching attribution from the queue at track-arrival time.
      // StumbleChat uses an SFU — one PC, many tracks via renegotiation — so
      // attributing at PC-creation time only ever catches the first broadcaster.
      // In SFU mode: subscribe fires → renegotiation → track arrives, in order.
      // FIFO pop at track time correctly pairs each subscribe with its track.
      const popFreshAttribution = () => {
        const now = Date.now();
        while (window._maraSubscribeQueue.length) {
          const entry = window._maraSubscribeQueue.shift();
          if (now - entry.ts < 2000) return entry;
          // stale — discard and keep looking
        }
        return null;
      };

      const watchPC = (pc) => {
        pc.addEventListener('track', (evt) => {
          if (evt.track.kind !== 'audio') return;
          const stream = evt.streams[0] || new MediaStream([evt.track]);
          const attr   = popFreshAttribution() || { handle: null, nick: null };
          capture(evt.track, stream, attr);
        });
      };

      const Orig = window.RTCPeerConnection;
      window.RTCPeerConnection = function (...args) {
        const pc = new Orig(...args);
        watchPC(pc);
        window._maraRTCPeers.push(pc);
        return pc;
      };
      window.RTCPeerConnection.prototype = Orig.prototype;
      try { Object.assign(window.RTCPeerConnection, Orig); } catch (_) {}

    }).catch(() => {});
  }

  // ── Called when WS fires a subscribe event for a given handle ────────────

  async notifySubscribe(handle, nick) {
    await this._page.evaluate((h, n) => {
      window._maraSubscribeQueue = window._maraSubscribeQueue || [];
      window._maraSubscribeQueue.push({ handle: h, nick: n, ts: Date.now() });
    }, handle, nick || handle).catch(() => {});
  }

  // ── Call AFTER page.goto() ────────────────────────────────────────────────
  // Exposes the Node callback and flushes any chunks buffered during page load.

  async start() {
    const roomName = this.roomName;

    await this._page.exposeFunction('__maraAudioChunk', ({ trackId, b64, sampleRate, handle, nick }) => {
      if (this._active) this.emit('chunk', { room: roomName, trackId, b64, sampleRate, handle, nick });
    }).catch(() => {});

    // flush anything captured during the preNavigate → start window
    await this._page.evaluate(() => {
      const queue = window._maraChunkQueue || [];
      window._maraChunkQueue = [];
      for (const chunk of queue) {
        try { window.__maraAudioChunk(chunk); } catch (_) {}
      }
    }).catch(() => {});

    this._active = true;
    console.log(`[Audio] Listening to WebRTC audio in: ${roomName}`);
  }

  stop() { this._active = false; }
}

module.exports = AudioCapture;
