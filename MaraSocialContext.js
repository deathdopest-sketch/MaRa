'use strict';

// SlashaSocialContext — Room intelligence and surveillance layer for Slasha
// Adapted from:
//   BOTUPGRADEMODULES/src/communication/social_context_awareness.js
//   ReapEye behavioral analytics
//
// Tracks: room dynamics, conversation flow, participant patterns,
// topic threads, emotional climate — all fed back as intel into Slasha's
// response context. Never announced — just surfaces as "she knows things."

class MaraSocialContext {
  constructor(logger) {
    this.log = logger;

    // Per-room state
    this.roomStates      = new Map();  // roomName → RoomState
    this.topicThreads    = new Map();  // roomName → topic history
    this.participantData = new Map();  // roomName → Map(handle → data)
    this.messageHistory  = new Map();  // roomName → recent messages[]
  }

  // ── Record incoming message ───────────────────────────────────────────────

  observe(roomName, nick, handle, text, ts = Date.now()) {
    this._ensureRoom(roomName);

    // Message history (last 50 per room)
    const hist = this.messageHistory.get(roomName);
    hist.push({ nick, handle: String(handle), text, ts });
    if (hist.length > 50) hist.shift();

    // Participant data
    const participants = this.participantData.get(roomName);
    if (!participants.has(String(handle))) {
      participants.set(String(handle), {
        handle: String(handle),
        nick,
        msgCount: 0,
        firstSeen: ts,
        lastSeen: ts,
        topicHistory: [],
        sentimentHistory: [],
      });
    }
    const p = participants.get(String(handle));
    p.msgCount++;
    p.lastSeen = ts;
    p.nick = nick;

    // Topic detection
    const topic = this._detectTopic(text);
    if (topic) {
      const threads = this.topicThreads.get(roomName);
      threads.push({ topic, nick, ts, snippet: text.slice(0, 60) });
      if (threads.length > 30) threads.shift();
      p.topicHistory.push(topic);
      if (p.topicHistory.length > 10) p.topicHistory.shift();
    }

    // Room state update
    const state = this.roomStates.get(roomName);
    state.lastActivity = ts;
    state.messageCount++;

    const sentiment = this._detectSentiment(text);
    state.recentSentiments.push(sentiment);
    if (state.recentSentiments.length > 20) state.recentSentiments.shift();
    p.sentimentHistory.push(sentiment);
    if (p.sentimentHistory.length > 10) p.sentimentHistory.shift();
  }

  // ── Get intel context for prompt injection ────────────────────────────────

  getRoomIntel(roomName, targetHandle = null) {
    if (!this.roomStates.has(roomName)) return null;

    const state        = this.roomStates.get(roomName);
    const hist         = this.messageHistory.get(roomName) || [];
    const threads      = this.topicThreads.get(roomName) || [];
    const participants = this.participantData.get(roomName) || new Map();

    const parts = [];

    // Active topics
    const recentTopics = [...new Set(threads.slice(-8).map(t => t.topic))];
    if (recentTopics.length) {
      parts.push(`[Room topics: ${recentTopics.join(', ')}]`);
    }

    // Room mood
    const avgSentiment = state.recentSentiments.length
      ? state.recentSentiments.reduce((s, v) => s + v, 0) / state.recentSentiments.length
      : 0.5;
    const moodLabel = avgSentiment > 0.65 ? 'warm/positive' : avgSentiment < 0.35 ? 'tense/negative' : 'neutral';
    parts.push(`[Room mood: ${moodLabel}]`);

    // Target handle intel
    if (targetHandle && participants.has(String(targetHandle))) {
      const p = participants.get(String(targetHandle));
      const avgP = p.sentimentHistory.length
        ? p.sentimentHistory.reduce((s, v) => s + v, 0) / p.sentimentHistory.length
        : 0.5;
      const userTopics = [...new Set(p.topicHistory)].slice(-3);
      parts.push(`[${p.nick} pattern: ${p.msgCount} msgs, mood ${avgP > 0.6 ? 'positive' : avgP < 0.4 ? 'negative' : 'neutral'}${userTopics.length ? ', topics: ' + userTopics.join('/') : ''}]`);
    }

    // What was said recently (2-3 lines of context)
    const recent = hist.slice(-4).map(m => `${m.nick}: ${m.text.slice(0, 60)}`).join(' | ');
    if (recent) parts.push(`[Recent: ${recent}]`);

    return parts.join(' ');
  }

  // ── Who's active in a room ────────────────────────────────────────────────

  getActiveParticipants(roomName, windowMs = 5 * 60 * 1000) {
    const participants = this.participantData.get(roomName);
    if (!participants) return [];
    const now = Date.now();
    return [...participants.values()].filter(p => now - p.lastSeen < windowMs);
  }

  // ── Topic detection ───────────────────────────────────────────────────────

  _detectTopic(text) {
    const lower = text.toLowerCase();
    if (/\b(code|bug|error|deploy|git|server|npm|node|socket|javascript|python)\b/.test(lower)) return 'coding';
    if (/\b(music|song|album|artist|band|listen|playing|track)\b/.test(lower)) return 'music';
    if (/\b(gothic|goth|dark|occult|punk|metal|void)\b/.test(lower)) return 'dark_culture';
    if (/\b(feel|sad|hurt|lonely|depressed|scared|anxious)\b/.test(lower)) return 'emotional';
    if (/\b(flirt|cute|hot|attractive|like you|want you)\b/.test(lower)) return 'romance';
    if (/\b(bot|ai|fake|not real|are you|prove)\b/.test(lower)) return 'bot_challenge';
    if (/\b(who|what|why|how|explain|think)\b.*\?/.test(lower)) return 'question';
    return null;
  }

  // ── Sentiment scoring (simple) ────────────────────────────────────────────

  _detectSentiment(text) {
    const lower = text.toLowerCase();
    const pos = (lower.match(/\b(good|great|nice|love|happy|yes|cool|awesome|fun|like|thanks|please|wow|lol|haha)\b/g) || []).length;
    const neg = (lower.match(/\b(bad|hate|stupid|awful|angry|no|fuck|shit|wrong|leave|stop|boring|dumb|ugly)\b/g) || []).length;
    const total = pos + neg;
    if (!total) return 0.5;
    return pos / total;
  }

  // ── Init room ─────────────────────────────────────────────────────────────

  _ensureRoom(roomName) {
    if (!this.roomStates.has(roomName)) {
      this.roomStates.set(roomName, {
        name: roomName,
        messageCount: 0,
        lastActivity: Date.now(),
        recentSentiments: [],
      });
      this.topicThreads.set(roomName, []);
      this.participantData.set(roomName, new Map());
      this.messageHistory.set(roomName, []);
    }
  }

  // ── Snapshot for debugging ────────────────────────────────────────────────

  getSnapshot(roomName) {
    return {
      state: this.roomStates.get(roomName),
      topics: (this.topicThreads.get(roomName) || []).slice(-10),
      participants: [...(this.participantData.get(roomName) || new Map()).values()],
      history: (this.messageHistory.get(roomName) || []).slice(-10),
    };
  }
}

module.exports = MaraSocialContext;
