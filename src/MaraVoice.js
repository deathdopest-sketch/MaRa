'use strict';

// mara's commentary layer.
// she watches long enough, she forms opinions.
// ollama if available, deterministic read if not.

const http = require('http');

const DWELL_MS = 8000;   // how long you have to sit on a user before she speaks

// ── Ollama ────────────────────────────────────────────────────────────────────

function _ollamaHost() {
  const raw = process.env.MARA_OLLAMA_HOST || '127.0.0.1:11434';
  const [host, port] = raw.split(':');
  return { host: host || '127.0.0.1', port: parseInt(port || '11434', 10) };
}

async function _askOllama(prompt) {
  const model = process.env.MARA_MODEL || 'llama3';
  const body  = JSON.stringify({
    model, prompt, stream: false,
    options: { temperature: 0.75, num_predict: 90 },
  });

  return new Promise((resolve) => {
    const { host, port } = _ollamaHost();
    const req = http.request(
      { host, port, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve(JSON.parse(raw).response?.trim() || null); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── Deterministic fallback — always works ─────────────────────────────────────

function _deterministic(p, socialNarrative) {
  const m     = p.moralityScore      || 5;
  const c     = p.cunningScore       || 3;
  const f     = p.formidabilityScore || 3;
  const v     = p.volatilityScore    || 3;
  const flags = new Set((p.flags || []).map(fl => fl.type));
  const neg   = p.negativeCount || 0;
  const pos   = p.positiveCount || 0;
  const msgs  = p.messages      || 0;

  const lines = [];

  // ── lead: most distinctive signal ──
  if (flags.has('directed_at_owner')) {
    lines.push(`Made us. Directed hostility at the owner ${p.directedHostility}×. Keep eyes on her.`);
  } else if (flags.has('manipulation_detected') && c > 6) {
    lines.push(`Calculating. The vagueness is deliberate — she's mapping the room before committing to anything.`);
  } else if (flags.has('gaslighting attempt') || flags.has('manipulation_detected')) {
    lines.push(`Manipulation patterns active. Consistent, not accidental.`);
  } else if ((p.aggressionSpikes || 0) >= 3 || m < 2.5) {
    lines.push(`Aggression close to the surface — ${p.aggressionSpikes || 0} spikes. She escalates fast and doesn't always de-escalate.`);
  } else if (v > 7.5) {
    lines.push(`Unstable. Mood flips without warning. Reactive, not strategic.`);
  } else if (f > 7 && m > 6) {
    lines.push(`She commands the room and she knows it. Others orient to her — worth watching how she uses that.`);
  } else if (c > 7) {
    lines.push(`Hard to read. Questions more than she answers, never commits to a position. Deliberate evasion or genuine uncertainty — unclear yet.`);
  } else if (m > 7.5 && v < 3) {
    lines.push(`Consistently warm. Either genuinely stable or very practiced at it.`);
  } else if (msgs < 5 || p.style === 'lurker') {
    lines.push(`Barely speaking. Lurking more than engaging — could be passive, could be watching.`);
  } else if (neg > pos * 2 && msgs > 10) {
    lines.push(`Predominantly negative across ${msgs} messages. That's not mood, that's pattern.`);
  } else {
    lines.push(`Nothing remarkable yet. ${msgs} messages in, still building a picture.`);
  }

  // ── texture: secondary signal from social layer ──
  if (socialNarrative) {
    const first = socialNarrative.split(/[.!]/).find(s => s.trim().length > 10);
    if (first) lines.push(first.trim() + '.');
  }

  // ── closing: predictive note ──
  if ((p.batchCount || 0) > 5) {
    lines.push(`Batches her messages — fragments her thoughts. Anxious typing pattern.`);
  } else if (flags.has('story_inconsistency')) {
    lines.push(`Story inconsistencies on record. Either memory or honesty issues.`);
  }

  return lines.slice(0, 2).join(' ');
}

// ── Public API ────────────────────────────────────────────────────────────────

function _buildPrompt(p, socialNarrative, roomContext) {
  const m = (p.moralityScore      || 5).toFixed(1);
  const c = (p.cunningScore       || 3).toFixed(1);
  const f = (p.formidabilityScore || 3).toFixed(1);
  const v = (p.volatilityScore    || 3).toFixed(1);
  const flags = [...new Set((p.flags || []).map(fl => fl.type))].slice(0, 5).join(', ');
  const pos = p.positiveCount || 0, neg = p.negativeCount || 0;
  const tot = pos + neg + (p.neutralCount || 0);
  const toneStr = tot > 0 ? `+${Math.round(pos/tot*100)}% -${Math.round(neg/tot*100)}%` : 'unknown';

  const stats = [
    `nick: ${p.nick}`,
    `messages: ${p.messages || 0}, style: ${p.style || 'unknown'}`,
    `morality: ${m}  cunning: ${c}  formidability: ${f}  volatility: ${v}`,
    `tone: ${toneStr}`,
    flags ? `flags: ${flags}` : null,
    (p.directedHostility || 0) > 0 ? `directed hostility at owner ×${p.directedHostility}` : null,
    socialNarrative ? `social read: ${socialNarrative}` : null,
    roomContext ? `room: ${roomContext}` : null,
  ].filter(Boolean).join('\n');

  return `You are Mara — a cold, perceptive intelligence observer watching a chat room. You never participate, only observe. Someone is looking at your profile for "${p.nick}".

Data:
${stats}

Give your honest read of this person in 1-2 short sentences. Be direct and perceptive. Synthesise the data into an insight — don't recite the numbers. No hedging, no disclaimers. Speak in your own voice.`;
}

async function think(p, socialNarrative, roomContext) {
  if (!p) return null;

  const prompt = _buildPrompt(p, socialNarrative, roomContext);
  const llm    = await _askOllama(prompt);
  return llm || _deterministic(p, socialNarrative);
}

module.exports = { think, DWELL_MS };
