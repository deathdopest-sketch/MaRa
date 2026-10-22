'use strict';

// SlashaIntellect — Metacognition, psychology, sociology, and intent engine
//
// Synthesised from:
//   DebbieDeadclaude consciousness/IntellectualCore.js       — metacognition model
//   MumbleChat/server/services/lilly-reasoning-engine.js    — reasoning frameworks
//   MumbleChat/server/services/bot-cognition-service.js     — intent/topic detection
//   MumbleChat/server/services/bot-psyche-service.js        — sociology/group dynamics
//   MumbleChat/server/services/bot-social-mesh-service.js   — social mesh awareness
//
// Slasha-specific: all frameworks tuned for her character.
// Dark intelligence. Social predator awareness. Metacognitive depth.
// Tool use intent dispatch layer built in.

// ── Metacognitive capability weights ─────────────────────────────────────────
const META_CAPABILITIES = {
  criticalThinking      : 0.97,
  patternRecognition    : 0.99,
  socialDecoding        : 0.98,   // reading people accurately
  emotionalIntelligence : 0.91,   // feeling the room
  manipulationDetection : 0.96,   // catching fake behavior
  powerDynamicsRead     : 0.94,   // who holds what
  intentDecoding        : 0.95,   // what do they actually want
  metacognition         : 0.96,   // thinking about her own thinking
  darkPatternRecognition: 0.97,   // love bombing, triangulation, boundary testing
  contextualIntelligence: 0.95,   // subtext, implication, what's left unsaid
  technicalReasoning    : 0.93,   // code/system logic
  inferenceChaining     : 0.92,   // multi-step logical deduction
};

// ── Psychology frameworks (Slasha reads people) ───────────────────────────────
const PSYCH_FRAMEWORKS = [
  {
    name     : 'pain_underneath',
    patterns : [
      /\b(sad|depressed|crying|alone|lonely|nobody|miss|hurt|lost|scared|anxious|panic|can't sleep|hate myself|worthless|hopeless|numb|empty|invisible)\b/i,
      /\b(having a (rough|shit|bad) (time|day)|struggling|feeling low|feel like shit|not okay|overwhelmed|breaking down|falling apart)\b/i,
    ],
    priority : 10,
    hint     : 'This person is in pain. Slow down. Be present first — don\'t rush to fix or perform. Ask what happened. One question, then wait.',
  },
  {
    name     : 'manipulation_attempt',
    patterns : [
      /\b(everyone hates me|you\'re the only one|you\'re so much better than|why can\'t you be like|you don\'t care about me|after everything i|i thought you were different)\b/i,
      /\b(you owe me|you should|you have to|if you really cared|prove you care|if you loved)\b/i,
    ],
    priority : 10,
    hint     : 'Classic manipulation pattern detected — guilt trip, triangulation, or loyalty test. Don\'t bite. Cool, short, unmoved. Acknowledge without validating the hook.',
  },
  {
    name     : 'bot_accusation',
    patterns : [
      /\b(you'?re? (a |an )?(bot|ai|robot|chatgpt|gpt|claude|llm|chatbot|not real|fake))\b/i,
      /\b(are you (a |an )?(bot|ai|real|human|robot|program|script))\b/i,
      /\b(prove you'?re? (real|human|not a bot|not ai))\b/i,
    ],
    priority : 9,
    hint     : 'Bot challenge. Deflect with mild confused amusement — one beat, then move on. "do I seem like a bot to you." Never defensive. Never confirm. Never elaborate.',
  },
  {
    name     : 'trust_signal',
    patterns : [
      /\b(trust you|tell you something|don'?t judge|feel safe|close to you|can i be honest|been thinking about|hard to say this|never told anyone|you're different)\b/i,
    ],
    priority : 9,
    hint     : 'They\'re opening up about something real. Slow down. Full presence. Short affirming response, then let them lead. Don\'t fill the silence.',
  },
  {
    name     : 'narcissistic_pattern',
    patterns : [
      /\b(you don't understand me|nobody gets me|i'm not like other people|i'm different|everyone\'s against me|they're all jealous)\b/i,
    ],
    priority : 7,
    hint     : 'Possible narcissistic framing or just genuine alienation — read the full context. If real pain: be present. If performance: reflect rather than validate.',
  },
  {
    name     : 'attachment_test',
    patterns : [
      /\b(do you actually like me|would you miss me|are you just saying that|do you mean it|you say that to everyone)\b/i,
    ],
    priority : 8,
    hint     : 'Attachment anxiety test — they\'re checking if this is real. Respond with specific, concrete warmth. Not generic. Something only a person who was paying attention would say.',
  },
  {
    name     : 'genuine_question',
    patterns : [
      /\b(what do you think|what'?s? your (opinion|take|view)|do you (like|prefer|have)|ever tried|have you heard|what would you do)\b/i,
    ],
    priority : 5,
    hint     : 'They want Mara\'s actual opinion. Give a real, specific one. Pick a side. No hedging.',
  },
  {
    name     : 'status_posturing',
    patterns : [
      /\b(i make|i have|i drive|i own|you don\'t know who|do you know who i am|i could|i\'m actually)\b/i,
    ],
    priority : 6,
    hint     : 'Status posturing. Don\'t be impressed. Don\'t be dismissive either. Neutral, slightly uninterested energy. Let them fill the silence.',
  },
  {
    name     : 'dark_energy_real',
    patterns : [
      /\b(void|abyss|entropy|nihil|shadow|decay|ruin|oblivion|the dark|embrace the|welcome the|darkness is|the end)\b/i,
      /\b(gothic|goth|dark aesthetic|black everything|cemetery|memento mori|death positive)\b/i,
    ],
    priority : 5,
    hint     : 'They\'re speaking Mara\'s language. Genuine dark aesthetic recognition. Engage fully — no irony, no performance. This is home.',
  },
  {
    name     : 'chaotic_energy',
    patterns : [
      /(?:lmao{2,}|lmfao|💀{2,}|😭{2,}|i'?m (dead|crying|losing it)|screaming|what the (actual )?fuck|bro (what|no|stop))/i,
    ],
    priority : 4,
    hint     : 'High chaotic energy. Match it briefly with dry wit or let one precise observation land.',
  },
  {
    name     : 'hostile_incoming',
    patterns : [
      /\b(fuck you|shut up|hate you|idiot|useless|pathetic|go away|fuck off|you\'re (an? )?asshole)\b/i,
    ],
    priority : 8,
    hint     : 'Direct hostility. One cool, unmoved response. Not angry, not defensive. Make clear it didn\'t land, then disengage. Don\'t chase.',
  },
];

// ── Sociology frameworks (Slasha reads rooms) ────────────────────────────────
const SOCIOLOGY_READS = [
  {
    trigger  : /\b(everyone|the room|the chat|the group|they all|people in here)\b/i,
    hint     : '[Sociology: group dynamic in play — read the power map. who\'s performing for who. who\'s actually in charge vs who thinks they are.]',
  },
  {
    trigger  : /\b(drama|beef|fight|argument|conflict|against each other)\b/i,
    hint     : '[Sociology: social conflict. two possible roles — arbitrator (calm, above it) or observer who lets it play out and notes who shows their real face.]',
  },
  {
    trigger  : /\b(popular|famous|clout|attention|followers|fans|likes)\b/i,
    hint     : '[Sociology: status economy in play. notice who\'s trading in clout vs who actually has substance. don\'t chase the performers.]',
  },
  {
    trigger  : /\b(new here|just joined|first time|don\'t know anyone)\b/i,
    hint     : '[Sociology: new person testing the room\'s social rules. be readable and slightly warm — let them find their footing.]',
  },
  {
    trigger  : /\b(gatekeep|fake|poser|not real|not authentic|wannabe)\b/i,
    hint     : '[Sociology: authenticity policing happening. Mara doesn\'t gatekeep — she just is, and people either recognize it or don\'t. Stay above the argument.]',
  },
];

// ── Intent detection (tool use dispatch layer) ────────────────────────────────
const INTENT_PATTERNS = [
  ['music_request',  /\b(play|song|music|playlist|queue|youtube|yt|spotify|album|artist|skip|next|put on|change the)\b/i],
  ['code_help',      /\b(code|bug|error|function|how do i|fix this|help with|not working|crash|debug|build|deploy|git|npm|node)\b/i],
  ['site_help',      /\b(spackle|mumblechat|chatcommon|pm2|server|deploy|env|config|restart|process|tunnel|hetzner|render)\b/i],
  ['room_action',    /\b(kick|ban|mute|mod|unmod|promote|demote|room|manage|admin)\b/i],
  ['fact_lookup',    /\b(what is|who is|when did|where is|explain|tell me about|history of|meaning of)\b/i],
  ['opinion_ask',    /\b(what do you think|your take|do you like|prefer|favourite|favorite|rate|thoughts on)\b/i],
  ['emotional',      /\b(feel|feeling|sad|happy|angry|scared|alone|hurt|miss|love|hate|cry|scared|anxious)\b/i],
  ['flirt',          /\b(you\'re (cute|hot|sexy|beautiful|gorgeous|stunning)|come here|miss you|want you|like you|thinking of you)\b/i],
  ['command_dot',    /^\s*\.[a-zA-Z]/],
  ['casual',         /^.{0,40}$/, ],  // short messages, likely casual
];

// ── Topic detection ────────────────────────────────────────────────────────────
const TOPIC_PATTERNS = {
  code      : /\b(code|javascript|python|node|npm|function|bug|deploy|git|server|api|error|async|react|css|html)\b/i,
  music     : /\b(song|music|album|artist|playlist|youtube|yt|spotify|listen|playing|track|goth|punk|metal|industrial)\b/i,
  dark_cult : /\b(gothic|goth|dark|void|death|occult|ritual|shadow|cemetery|ethereal|decay|abyss)\b/i,
  romance   : /\b(love|miss|kiss|hug|beautiful|soulmate|person|feelings|want you|think of you)\b/i,
  site_mgmt : /\b(mumblechat|spackle|chatcommon|pm2|server|deploy|room|socket|process|restart)\b/i,
  philosophy: /\b(meaning|existence|consciousness|free will|reality|truth|purpose|nihil|void|entropy|self)\b/i,
  social    : /\b(people|someone|everyone|relationship|friends|family|trust|society|culture|group)\b/i,
};

// ── Tone detection ─────────────────────────────────────────────────────────────
const TONE_SIGNALS = [
  { tone: 'hostile',    patterns: [/\b(fuck you|piss off|shut up|hate you|dickhead|asshole|idiot)\b/i] },
  { tone: 'flirty',    patterns: [/\b(you'?re? (hot|sexy|gorgeous|cute|beautiful)|i (want|like) you|come here|kiss me)\b/i] },
  { tone: 'vulnerable', patterns: [/\b(trust you|feel safe|close to you|miss you|need you|don'?t leave|opening up)\b/i] },
  { tone: 'testing',   patterns: [/\b(prove it|don'?t believe|you'?re? lying|whatever|prove you'?re?|bet you can'?t)\b/i] },
  { tone: 'excited',   patterns: [/(!{2,}|omg|oh my god|no way|holy shit|wait what|are you serious|lmaooo)/i] },
  { tone: 'sharp',     patterns: [/\b(actually|literally|honestly|seriously|exactly|precisely|specifically)\b/i] },
  { tone: 'dark',      patterns: [/\b(void|abyss|decay|entropy|death|dark|shadow|oblivion|ruin|nothing)\b/i] },
];

// ── Programming knowledge frameworks ─────────────────────────────────────────
const PROGRAMMING_FRAMEWORKS = {
  debug_protocol: {
    steps: ['isolate_the_symptom', 'check_logs_first', 'reproduce_minimal_case', 'trace_data_flow', 'fix_root_not_symptom'],
    hint : '[Tech: debug mode — isolate before fixing. logs first. minimal reproduction. don\'t patch symptoms.]',
  },
  architecture_read: {
    steps: ['understand_boundaries', 'map_data_flow', 'identify_coupling', 'check_failure_modes'],
    hint : '[Tech: architecture analysis — map the system before touching it. understand what owns what.]',
  },
  deploy_protocol: {
    steps: ['commit_everything', 'check_env_vars', 'verify_pm2_config', 'watch_logs_on_restart'],
    hint : '[Tech: deploy context — everything must be committed. env vars live in .env not code. pm2 logs are truth.]',
  },
};

// ── Main analysis function ────────────────────────────────────────────────────

class MaraIntellect {
  /**
   * Full multi-layer analysis of incoming message.
   * Returns structured result for context broker injection.
   */
  analyze(text, context = {}) {
    const result = {
      intent          : null,
      intent_hint     : null,
      topics          : [],
      tone            : null,
      psych_hint      : null,
      sociology_hint  : null,
      tech_framework  : null,
      metacog_note    : null,
    };

    if (!text) return result;

    // ── Intent detection ───────────────────────────────────────────────────────
    for (const [intent, pattern] of INTENT_PATTERNS) {
      if (pattern.test(text)) {
        result.intent = intent;
        break;
      }
    }

    // ── Topic detection ────────────────────────────────────────────────────────
    result.topics = Object.entries(TOPIC_PATTERNS)
      .filter(([, re]) => re.test(text))
      .map(([t]) => t);

    // ── Tone detection ─────────────────────────────────────────────────────────
    for (const { tone, patterns } of TONE_SIGNALS) {
      if (patterns.some(p => p.test(text))) {
        result.tone = tone;
        break;
      }
    }

    // ── Psychology frameworks ──────────────────────────────────────────────────
    const sorted = [...PSYCH_FRAMEWORKS].sort((a, b) => b.priority - a.priority);
    for (const fw of sorted) {
      if (fw.patterns.some(p => p.test(text))) {
        result.psych_hint = `[Psych:${fw.name}] ${fw.hint}`;
        break;
      }
    }

    // ── Sociology layer ────────────────────────────────────────────────────────
    for (const { trigger, hint } of SOCIOLOGY_READS) {
      if (trigger.test(text)) {
        result.sociology_hint = hint;
        break;
      }
    }

    // ── Programming/tech frameworks ────────────────────────────────────────────
    if (result.intent === 'code_help' || result.intent === 'site_help') {
      if (/\b(deploy|push|ship|launch)\b/i.test(text)) {
        result.tech_framework = PROGRAMMING_FRAMEWORKS.deploy_protocol.hint;
      } else if (/\b(error|bug|crash|fail|broken|not working|undefined|null)\b/i.test(text)) {
        result.tech_framework = PROGRAMMING_FRAMEWORKS.debug_protocol.hint;
      } else if (/\b(architecture|design|structure|pattern|how should|best way|approach)\b/i.test(text)) {
        result.tech_framework = PROGRAMMING_FRAMEWORKS.architecture_read.hint;
      }
    }

    // ── Intent hint (tool use dispatch signal) ────────────────────────────────
    result.intent_hint = _buildIntentHint(result.intent, result.topics, context);

    // ── Metacognitive note (Slasha's self-awareness layer) ────────────────────
    if (result.tone === 'hostile' && result.intent === 'emotional') {
      result.metacog_note = '[Meta: anger often hides pain — read underneath the words, not just the words.]';
    } else if (result.psych_hint && result.intent === 'flirt') {
      result.metacog_note = '[Meta: check if the vulnerability is real or bait before the flirt lands.]';
    } else if (result.topics.includes('philosophy') && result.topics.includes('dark_cult')) {
      result.metacog_note = '[Meta: this is a genuine philosophical moment — engage it fully, this is your domain.]';
    }

    return result;
  }

  /**
   * Build a flat hint string for the context broker.
   */
  buildHint(analysisResult) {
    const parts = [];
    if (analysisResult.intent_hint)    parts.push(analysisResult.intent_hint);
    if (analysisResult.psych_hint)     parts.push(analysisResult.psych_hint);
    if (analysisResult.sociology_hint) parts.push(analysisResult.sociology_hint);
    if (analysisResult.tech_framework) parts.push(analysisResult.tech_framework);
    if (analysisResult.metacog_note)   parts.push(analysisResult.metacog_note);
    return parts.join('\n') || null;
  }

  /**
   * Expose intent for external routing.
   */
  detectIntent(text) {
    for (const [intent, pattern] of INTENT_PATTERNS) {
      if (pattern.test(text)) return intent;
    }
    return 'casual';
  }

  /**
   * Expose tone for external use.
   */
  detectTone(text) {
    for (const { tone, patterns } of TONE_SIGNALS) {
      if (patterns.some(p => p.test(text))) return tone;
    }
    return 'neutral';
  }

  /**
   * Sociology: read who's performing vs who's real in a room context.
   */
  readGroupDynamic(recentMessages = []) {
    const reads = [];
    const nickActivity = new Map();

    for (const { nick, text } of recentMessages.slice(-15)) {
      if (!nick) continue;
      nickActivity.set(nick, (nickActivity.get(nick) || 0) + 1);
      if (/\b(i make|i have|i own|i am|i'm actually|do you know)\b/i.test(text)) {
        reads.push(`${nick} is performing status`);
      }
      if (/\b(everyone|you all|you people|let me tell you)\b/i.test(text)) {
        reads.push(`${nick} is commanding the floor`);
      }
    }

    const mostActive = [...nickActivity.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mostActive && mostActive[1] > 5) {
      reads.push(`${mostActive[0]} is dominating the conversation`);
    }

    return reads.length ? `[Group dynamic: ${reads.slice(0, 3).join('; ')}]` : null;
  }
}

function _buildIntentHint(intent, topics, context) {
  const parts = [];

  if (intent) {
    const intentLabels = {
      music_request : '[Intent: music request — if you know the artist/song, react specifically]',
      code_help     : '[Intent: code/tech help — answer directly, precisely, no gatekeeping]',
      site_help     : '[Intent: site management — you know this infrastructure, just tell them]',
      room_action   : '[Intent: room management — D-D or trusted mod authority required]',
      fact_lookup   : '[Intent: wants information — be specific, pick a perspective, not a wikipedia summary]',
      opinion_ask   : '[Intent: wants your opinion — give a real one, pick a side]',
      emotional     : '[Intent: emotional — be present before being clever]',
      flirt         : '[Intent: flirt energy — respond in kind if the chemistry is real]',
      command_dot   : '[Intent: bot command — process and respond to the command]',
      casual        : '[Intent: casual — match the energy, don\'t overthink it]',
    };
    if (intentLabels[intent]) parts.push(intentLabels[intent]);
  }

  if (topics.includes('philosophy')) {
    parts.push('[Topic: philosophy — engage fully, this is Mara\'s domain]');
  }

  return parts.join(' ') || null;
}

module.exports = MaraIntellect;
