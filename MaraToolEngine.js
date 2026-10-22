'use strict';

// SlashaToolEngine — Intent-to-action dispatch layer
//
// Slasha understands what tools/commands exist in the system and can
// recognize when a message is actually a tool request, not a conversation.
// She can dispatch to bot commands, route to specific handlers, and describe
// her own capabilities when asked.
//
// Tool categories:
//   music      — play, queue, skip, stop, youtube links
//   moderation — kick, ban, mute, mod, room manage
//   memory     — remember, profile, who said, what did X say
//   intel      — surveillance, room state, who's active
//   tech       — code help, deploy, debug, site management
//   meta       — what can you do, help, capabilities

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = {
  music_play: {
    patterns : [/\bplay\s+(https?:\/\/\S+|\w[\w\s]*)/i, /\bput on\s+/i, /\bqueue\s+/i],
    category : 'music',
    action   : 'play',
    hint     : '[Tool: music.play — extract URL or artist/song name and forward to music service]',
    needs_bot: true,
  },
  music_skip: {
    patterns : [/\b(skip|next song|next track|change it|skip this)\b/i],
    category : 'music',
    action   : 'skip',
    hint     : '[Tool: music.skip — skip current track]',
    needs_bot: true,
  },
  music_stop: {
    patterns : [/\b(stop (the )?music|stop playing|turn it off|quiet|silence)\b/i],
    category : 'music',
    action   : 'stop',
    hint     : '[Tool: music.stop — stop playback]',
    needs_bot: true,
  },
  memory_recall: {
    patterns : [/\b(who said|what did .+ say|do you remember|earlier .+ said|remind me)\b/i],
    category : 'memory',
    action   : 'recall',
    hint     : '[Tool: memory.recall — check message history and user dossier for relevant context]',
    needs_bot: false,
  },
  memory_profile: {
    patterns : [/\b(profile .+|what do you know about|tell me about .+|who is .+)\b/i],
    category : 'memory',
    action   : 'profile',
    hint     : '[Tool: memory.profile — look up user dossier]',
    needs_bot: false,
  },
  intel_room: {
    patterns : [/\b(who'?s? (in|here|active|online)|room state|who'?s? around|anyone (here|around|watching))\b/i],
    category : 'intel',
    action   : 'room_state',
    hint     : '[Tool: intel.room — check active participants and recent room activity]',
    needs_bot: false,
  },
  mod_kick: {
    patterns : [/\b(kick .+|boot .+|remove .+from|get rid of)\b/i],
    category : 'moderation',
    action   : 'kick',
    hint     : '[Tool: mod.kick — requires D-D/owner authorization. Confirm before acting.]',
    needs_bot: true,
    requires_owner: true,
  },
  mod_ban: {
    patterns : [/\b(ban .+|perma .+|permaban .+)\b/i],
    category : 'moderation',
    action   : 'ban',
    hint     : '[Tool: mod.ban — requires D-D/owner authorization. Log action in memory.]',
    needs_bot: true,
    requires_owner: true,
  },
  tech_deploy: {
    patterns : [/\b(deploy|push to|ship it|launch|go live|push .+ to)\b/i],
    category : 'tech',
    action   : 'deploy_guidance',
    hint     : '[Tool: tech.deploy — walk through deploy checklist: commit everything first, env vars, pm2 restart, watch logs]',
    needs_bot: false,
  },
  tech_debug: {
    patterns : [/\b(debug|trace|why is .+ broken|what'?s? wrong with|error in|crash in|not working)\b/i],
    category : 'tech',
    action   : 'debug_guidance',
    hint     : '[Tool: tech.debug — isolate symptom, check logs, reproduce minimal case, fix root not symptom]',
    needs_bot: false,
  },
  mara_capabilities: {
    patterns : [/\b(what can you do|what are you capable of|your (abilities|skills|features|tools)|help me understand|how do you work)\b/i],
    category : 'meta',
    action   : 'capabilities',
    hint     : '[Tool: meta.capabilities — describe what Mara can do in her voice, not a feature list]',
    needs_bot: false,
  },
};

// ── Context window / conversation understanding ───────────────────────────────
// Slasha tracks what topic/thread the conversation is actually about,
// separate from the literal message. Used to understand multi-turn intent.

class ConversationContext {
  constructor(maxHistory = 20) {
    this._history    = [];          // [{nick, text, ts, intent, tone}]
    this._thread     = null;        // current active topic thread
    this._maxHistory = maxHistory;
  }

  record(nick, text, analysisResult = {}) {
    const entry = {
      nick,
      text  : text.slice(0, 200),
      ts    : Date.now(),
      intent: analysisResult.intent   || 'casual',
      tone  : analysisResult.tone     || 'neutral',
      topics: analysisResult.topics   || [],
    };
    this._history.push(entry);
    if (this._history.length > this._maxHistory) this._history.shift();

    // Update thread if a non-casual intent was detected
    if (entry.intent && entry.intent !== 'casual') {
      this._thread = { intent: entry.intent, topics: entry.topics, since: entry.ts };
    }
  }

  getThread()  { return this._thread; }
  getHistory() { return this._history.slice(); }

  /**
   * Infer what the conversation is actually about right now.
   * Used to maintain topic continuity across multi-turn exchanges.
   */
  getThreadHint() {
    if (!this._thread) return null;
    const age = (Date.now() - this._thread.since) / 1000;
    if (age > 300) {    // thread expires after 5 minutes
      this._thread = null;
      return null;
    }
    const topicStr = this._thread.topics.length ? ` (${this._thread.topics.join(', ')})` : '';
    return `[Conversation thread: ${this._thread.intent}${topicStr} — maintain continuity]`;
  }

  /**
   * Look for a specific topic or person mentioned in recent history.
   */
  searchHistory(query) {
    const lower = query.toLowerCase();
    return this._history.filter(e => e.text.toLowerCase().includes(lower));
  }

  /**
   * Get the last N messages, formatted for context injection.
   */
  getRecentContext(n = 5) {
    return this._history.slice(-n)
      .map(e => `${e.nick}: ${e.text}`)
      .join('\n');
  }
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

class MaraToolEngine {
  constructor() {
    this._convCtx = new ConversationContext();
  }

  /**
   * Match a message against tool patterns.
   * Returns the matched tool definition or null.
   */
  matchTool(text) {
    for (const [, tool] of Object.entries(TOOLS)) {
      if (tool.patterns.some(p => p.test(text))) {
        return tool;
      }
    }
    return null;
  }

  /**
   * Full analysis: match tool, record context, build hint string.
   */
  process(nick, text, analysisResult = {}) {
    this._convCtx.record(nick, text, analysisResult);

    const tool        = this.matchTool(text);
    const threadHint  = this._convCtx.getThreadHint();

    const hints = [];
    if (tool)       hints.push(tool.hint);
    if (threadHint) hints.push(threadHint);

    return {
      tool         : tool ? { category: tool.category, action: tool.action, requiresOwner: tool.requires_owner || false } : null,
      tool_hint    : tool ? tool.hint : null,
      thread_hint  : threadHint,
      combined_hint: hints.join('\n') || null,
    };
  }

  /**
   * Record a message with context without full tool matching.
   * Used for passive observation of non-Slasha messages.
   */
  observe(nick, text, analysisResult = {}) {
    this._convCtx.record(nick, text, analysisResult);
  }

  /**
   * Get conversation context for context broker injection.
   */
  getContextHint(n = 4) {
    const recent = this._convCtx.getRecentContext(n);
    const thread = this._convCtx.getThreadHint();
    const parts  = [];
    if (thread) parts.push(thread);
    if (recent) parts.push(`[Recent exchanges:\n${recent}]`);
    return parts.join('\n') || null;
  }

  /**
   * Search conversation history for something specific.
   */
  searchHistory(query) {
    return this._convCtx.searchHistory(query);
  }

  getConversationContext() { return this._convCtx; }
}

module.exports = MaraToolEngine;
