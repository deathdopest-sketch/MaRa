'use strict';

// MaraActuator — turns MaraToolEngine intent matches into real actions.
//
// Categories wired:
//   memory.recall   → search MaraSocialContext message history, inject results
//   memory.profile  → look up MaraMemory dossier for named user, inject
//   intel.room      → pull live participant + mood data from MaraSocialContext, inject
//   music.play      → queue YouTube video/search via WS
//   music.skip      → skip current track via WS
//   music.stop      → stop playback via WS
//   mod.kick        → kick named user via WS (owner-only)
//   mod.ban         → ban named user via WS (owner-only)
//   tech.*          → prompt-only, no execution

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTarget(text) {
  // "kick death", "ban skitzho3", "what do you know about death", "who is n_n"
  const m = text.match(/(?:kick|ban|boot|remove|profile|about|who is|tell me about)\s+([a-zA-Z0-9_\-]+)/i);
  return m ? m[1] : null;
}

function extractMusicQuery(text) {
  // YouTube URL
  const urlMatch = text.match(/(https?:\/\/(?:www\.)?youtu(?:be\.com|\.be)\/\S+)/i);
  if (urlMatch) return { type: 'url', value: urlMatch[1] };
  // "play X" / "put on X" / "queue X"
  const queryMatch = text.match(/(?:play|put on|queue)\s+(.+)/i);
  if (queryMatch) return { type: 'search', value: queryMatch[1].trim() };
  return null;
}

// ── MaraActuator ──────────────────────────────────────────────────────────────

class MaraActuator {
  /**
   * @param {object} deps
   * @param {object} deps.ccClient    ChatCommonClient instance
   * @param {object} deps.socialCtx   MaraSocialContext instance
   * @param {object} deps.memory      MaraMemory instance
   * @param {object} deps.history     ConversationHistory instance
   * @param {Set}    deps.ownerHandles set of owner handle strings
   * @param {object} deps.log         logger
   */
  constructor({ ccClient, socialCtx, memory, history, ownerHandles, log }) {
    this._cc      = ccClient;
    this._social  = socialCtx;
    this._memory  = memory;
    this._history = history;
    this._owners  = ownerHandles || new Set();
    this.log      = log;
  }

  /**
   * Execute a detected tool intent.
   *
   * @param {object|null} tool     toolResult.tool from MaraToolEngine
   * @param {string}      text     original message text
   * @param {object}      ctx      { roomName, senderHandle, senderNick, isOwner }
   *
   * @returns {{ mode: 'inject'|'act'|'none', inject?: string, reply?: string }}
   *   inject — extra context string to append to systemPrompt before Ollama
   *   act    — Mara already took the action; skip Ollama, optionally send reply
   *   none   — nothing to do (no actionable tool, or insufficient permissions)
   */
  execute(tool, text, ctx = {}) {
    if (!tool) return { mode: 'none' };

    const { roomName, senderHandle, isOwner } = ctx;

    switch (tool.action) {

      case 'recall':
        return this._doRecall(text, roomName);

      case 'profile':
        return this._doProfile(text, roomName);

      case 'room_state':
        return this._doRoomState(roomName, senderHandle);

      case 'play':
        return this._doMusicPlay(text, roomName);

      case 'skip':
        return this._doMusicSkip(roomName);

      case 'stop':
        return this._doMusicStop(roomName);

      case 'kick':
        if (!isOwner) return { mode: 'none' };
        return this._doKick(text, roomName);

      case 'ban':
        if (!isOwner) return { mode: 'none' };
        return this._doBan(text, roomName);

      default:
        return { mode: 'none' };
    }
  }

  // ── Memory: recall ────────────────────────────────────────────────────────

  _doRecall(text, roomName) {
    const results = [];

    // Search MaraSocialContext message history
    if (this._social && roomName) {
      const hist = this._social.messageHistory?.get(roomName) || [];
      const lower = text.toLowerCase();
      // extract what they're looking for: "who said X" / "what did X say"
      const aboutMatch = text.match(/(?:who said|what did\s+(\w+)\s+say|do you remember|earlier.*said)\s*(.+)?/i);
      const query = aboutMatch ? (aboutMatch[2] || aboutMatch[1] || '').trim().toLowerCase() : lower;

      if (query.length > 2) {
        const matches = hist.filter(m => m.text.toLowerCase().includes(query));
        if (matches.length) {
          const lines = matches.slice(-5).map(m => `${m.nick}: ${m.text}`).join('\n');
          results.push(`[Message history match for "${query}":\n${lines}]`);
        } else {
          results.push(`[No recent messages found matching "${query}"]`);
        }
      }
    }

    return results.length
      ? { mode: 'inject', inject: results.join('\n') }
      : { mode: 'none' };
  }

  // ── Memory: profile ───────────────────────────────────────────────────────

  _doProfile(text, roomName) {
    const target = extractTarget(text);
    if (!target) return { mode: 'none' };

    // Look up by nick first via socialCtx participant data
    let handle = null;
    if (this._social && roomName) {
      const participants = this._social.participantData?.get(roomName);
      if (participants) {
        for (const [h, p] of participants) {
          if (p.nick?.toLowerCase() === target.toLowerCase()) { handle = h; break; }
        }
      }
    }
    // Fall back to using target as handle
    if (!handle) handle = target;

    const dossier = this._memory?.getDossierSummary?.(handle);
    if (!dossier) {
      return { mode: 'inject', inject: `[No dossier found for "${target}" — not seen before or handle mismatch]` };
    }

    const summary = [
      `[Dossier for ${dossier.nick}:`,
      `  trust: ${dossier.trustLevel} | relationship: ${dossier.relationship}`,
      `  seen: ${dossier.interactionCount} interactions | first: ${new Date(dossier.firstSeen).toLocaleDateString()}`,
      dossier.manipulationFlags?.length ? `  flags: ${dossier.manipulationFlags.join(', ')}` : null,
      dossier.notes?.length ? `  notes: ${dossier.notes.slice(-3).join('; ')}` : null,
      dossier.mood_reads?.length ? `  recent mood: ${dossier.mood_reads.slice(-1)[0]}` : null,
      ']',
    ].filter(Boolean).join('\n');

    return { mode: 'inject', inject: summary };
  }

  // ── Intel: room state ─────────────────────────────────────────────────────

  _doRoomState(roomName, requestingHandle) {
    if (!this._social || !roomName) return { mode: 'none' };

    const intel = this._social.getRoomIntel?.(roomName, requestingHandle);
    if (!intel) return { mode: 'none' };

    // getRoomIntel already returns a formatted string
    return { mode: 'inject', inject: `[Live room intel:\n${intel}]` };
  }

  // ── Music: play ───────────────────────────────────────────────────────────

  _doMusicPlay(text, roomName) {
    if (!this._cc?.isConnected || !roomName) return { mode: 'none' };

    const query = extractMusicQuery(text);
    if (!query) return { mode: 'none' };

    // Try all known ChatCommon YouTube queue message shapes
    if (query.type === 'url') {
      this._cc._send({ type: 'youtube_queue_add',  room: roomName, url: query.value });
      this._cc._send({ type: 'add_to_youtube_queue', room: roomName, url: query.value });
      this._cc._send({ type: 'queue_youtube',       room: roomName, url: query.value });
      this.log?.info(`[Actuator] music.play url: ${query.value} → ${roomName}`);
    } else {
      this._cc._send({ type: 'youtube_queue_add',  room: roomName, search: query.value });
      this._cc._send({ type: 'add_to_youtube_queue', room: roomName, search: query.value });
      this._cc._send({ type: 'queue_youtube',       room: roomName, search: query.value });
      this.log?.info(`[Actuator] music.play search: "${query.value}" → ${roomName}`);
    }

    return {
      mode : 'inject',
      inject: `[music.play dispatched — ${query.type === 'url' ? query.value : '"' + query.value + '"'}]`,
    };
  }

  // ── Music: skip ───────────────────────────────────────────────────────────

  _doMusicSkip(roomName) {
    if (!this._cc?.isConnected || !roomName) return { mode: 'none' };

    this._cc._send({ type: 'youtube_skip',      room: roomName });
    this._cc._send({ type: 'skip_youtube',      room: roomName });
    this._cc._send({ type: 'youtube_queue_skip', room: roomName });
    this.log?.info(`[Actuator] music.skip → ${roomName}`);

    return { mode: 'inject', inject: '[music.skip dispatched]' };
  }

  // ── Music: stop ───────────────────────────────────────────────────────────

  _doMusicStop(roomName) {
    if (!this._cc?.isConnected || !roomName) return { mode: 'none' };

    this._cc._send({ type: 'youtube_stop',       room: roomName });
    this._cc._send({ type: 'stop_youtube',        room: roomName });
    this._cc._send({ type: 'youtube_queue_clear', room: roomName });
    this.log?.info(`[Actuator] music.stop → ${roomName}`);

    return { mode: 'inject', inject: '[music.stop dispatched]' };
  }

  // ── Moderation: kick ──────────────────────────────────────────────────────

  _doKick(text, roomName) {
    const target = extractTarget(text);
    if (!target || !roomName) return { mode: 'none' };

    this._cc._send({ type: 'kick_user', username: target, room: roomName });
    this._cc._send({ type: 'room_kick', username: target, room: roomName });
    this.log?.info(`[Actuator] mod.kick: ${target} from ${roomName}`);

    return {
      mode : 'act',
      reply: `*${target} removed*`,
    };
  }

  // ── Moderation: ban ───────────────────────────────────────────────────────

  _doBan(text, roomName) {
    const target = extractTarget(text);
    if (!target || !roomName) return { mode: 'none' };

    this._cc._send({ type: 'ban_user',  username: target, room: roomName });
    this._cc._send({ type: 'room_ban',  username: target, room: roomName });
    this.log?.info(`[Actuator] mod.ban: ${target} from ${roomName}`);

    return {
      mode : 'act',
      reply: `*${target} banned*`,
    };
  }
}

module.exports = MaraActuator;
