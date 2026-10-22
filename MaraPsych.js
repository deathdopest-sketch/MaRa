'use strict';

// SlashaPsych — Slasha-specific interpretation layer over PsychAnalyzer
// Reuses src/ai/PsychAnalyzer.js — does NOT duplicate it
// Maps psych + NNN results → response mode for the LLM system prompt

let _PsychAnalyzer = null;
function _getAnalyzer() {
  if (!_PsychAnalyzer) {
    try {
      _PsychAnalyzer = require('./lib/PsychAnalyzer');
    } catch {
      return null;
    }
  }
  return _PsychAnalyzer;
}

// Response modes — inform system prompt context injected before LLM call
const MODES = {
  FLIRT      : 'flirt',        // D-D/Death is speaking — warmth, play, loyalty
  TECH       : 'tech',         // coding/site-mgmt question — direct expert answer
  AUTHORITY  : 'authority',    // challenge/hostility — Demonika-style controlled response
  INFILTRATOR: 'infiltrator',  // bot accusation — cool dismissal, don't confirm
  DARK       : 'dark',         // dark culture conversation — match the register
  MUSIC      : 'music',        // music conversation — deep knowledge mode
  MANIP      : 'manip',        // manipulation attempt detected — watch + deflect
  NEUTRAL    : 'neutral',      // default — cool, observational, present
};

function interpret(text, nnnResult, senderHandle, ownerHandles = new Set()) {
  const PA = _getAnalyzer();
  let psychResult = null;
  if (PA) {
    try {
      psychResult = typeof PA.analyze === 'function'
        ? PA.analyze(text)
        : (typeof PA === 'function' ? PA(text) : null);
    } catch { /* analyzer optional */ }
  }

  // Owner / D-D check — highest priority
  if (ownerHandles.has(String(senderHandle)) || nnnResult?.flirtMode) {
    return { mode: MODES.FLIRT, psychResult, nnnResult };
  }

  // Manipulation detected — watch mode before anything else
  if (nnnResult?.manipDetected) {
    return { mode: MODES.MANIP, psychResult, nnnResult };
  }

  // Bot challenge
  if (nnnResult?.authorityChallenge || nnnResult?.botRisk > 0.5) {
    return { mode: MODES.INFILTRATOR, psychResult, nnnResult };
  }

  // Authority / hostility from psychResult
  if (psychResult) {
    const intent = psychResult.intent || psychResult.primary_intent || '';
    const emotion = psychResult.dominantEmotion || psychResult.emotion || '';
    if (intent === 'hostile' || emotion === 'anger' || psychResult.risk > 0.6) {
      return { mode: MODES.AUTHORITY, psychResult, nnnResult };
    }
  }

  // Tech question
  if (nnnResult?.techMode) {
    return { mode: MODES.TECH, psychResult, nnnResult };
  }

  // Music
  if (nnnResult?.musicMode) {
    return { mode: MODES.MUSIC, psychResult, nnnResult };
  }

  // Dark culture
  if (nnnResult?.darkMode) {
    return { mode: MODES.DARK, psychResult, nnnResult };
  }

  return { mode: MODES.NEUTRAL, psychResult, nnnResult };
}

// Returns a short mode-specific context line to inject into the LLM prompt
function getModeHint(mode) {
  switch (mode) {
    case MODES.FLIRT:
      return '[MODE: D-D is here — be warm, flirty, loyal. call him D-D or Death. this is your person.]';
    case MODES.TECH:
      return '[MODE: technical question — answer directly and precisely, like someone who just knows. no help-desk tone. short.]';
    case MODES.AUTHORITY:
      return '[MODE: hostility or challenge — controlled, Demonika-style authority. don\'t rise to it. one precise line, then done.]';
    case MODES.INFILTRATOR:
      return '[MODE: bot accusation — cool dismissal. confused, slightly amused, not defensive. redirect after. never confirm.]';
    case MODES.DARK:
      return '[MODE: dark aesthetic conversation — match the register. gothic, dry, knowing. you\'re comfortable here.]';
    case MODES.MUSIC:
      return '[MODE: music conversation — deep knowledge mode. specific, opinionated, real. you actually listened to this.]';
    case MODES.MANIP:
      return '[MODE: manipulation pattern detected — watch this one. don\'t call it out directly. be cooler, shorter, less available.]';
    default:
      return '[MODE: default — cool, observational, present. short. dark edge natural.]';
  }
}

module.exports = { interpret, getModeHint, MODES };
