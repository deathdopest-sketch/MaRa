'use strict';

// SlashaContextBroker — priority-ordered context assembler for Slasha
// Adapted from MumbleChat/server/services/lilly-context-broker.js
//
// Collects signals from all intelligence layers and assembles them into a
// single CURRENT CONTEXT block for the Ollama prompt. Lower-priority
// signals are dropped first if character budget is exceeded.

// Priority order: lower index = included first, dropped last
const PRIORITY_ORDER = [
  'owner_status',      // D-D / owner recognition — most critical
  'nsfw_mode',         // NSFW mode active
  'emotional',         // sender's current emotional state
  'intent',            // what they actually want (tool/command/emotional/casual)
  'social_thread',     // what the conversation is actually about right now
  'reasoning',         // pre-analysis framework hints (SlashaReasoning)
  'psych_mode',        // psychanalysis mode output
  'assoc_recall',      // past patterns with this person (SlashaMemory dossier)
  'room_intel',        // social context room intelligence
  'sociology',         // group dynamics, power map, who's performing
  'tool_hint',         // tool use dispatch signal
  'knowledge',         // domain knowledge snippet
  'template_hint',     // cookie cutter response template
  'recent_replies',    // dedup guard (avoid repeating self)
  'room_mood',         // room sentiment summary
  'time',              // time context
];

// Soft character budget — signals past this point are candidates for dropping
const CONTEXT_CHAR_BUDGET = 3800;

class MaraContextBroker {
  constructor() {
    this._signals = new Map();
  }

  /**
   * Set a named context signal. Pass null/empty/undefined to skip.
   */
  set(name, content) {
    if (content && String(content).trim()) {
      this._signals.set(name, String(content).trim());
    }
  }

  /**
   * Build the assembled context string, respecting priority order.
   * Drops lower-priority signals if budget exceeded.
   */
  build() {
    const ordered = [];

    for (const name of PRIORITY_ORDER) {
      if (this._signals.has(name)) {
        ordered.push({ name, content: this._signals.get(name) });
      }
    }

    // Signals not in PRIORITY_ORDER appended last
    for (const [name, content] of this._signals.entries()) {
      if (!PRIORITY_ORDER.includes(name)) {
        ordered.push({ name, content });
      }
    }

    const parts = [];
    let total = 0;

    for (const { content } of ordered) {
      if (total + content.length > CONTEXT_CHAR_BUDGET) break;
      parts.push(content);
      total += content.length;
    }

    return parts.length ? '[CONTEXT]\n' + parts.join('\n') + '\n[/CONTEXT]' : '';
  }

  /** Build, return string, then clear for reuse. */
  flush() {
    const result = this.build();
    this._signals.clear();
    return result;
  }

  clear() { this._signals.clear(); }
  size()  { return this._signals.size; }
}

module.exports = MaraContextBroker;
