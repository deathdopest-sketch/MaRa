'use strict';

// MaraAcronym — MARA backronym pool + trigger detection
//
// Official label   : Mood Analysis & Relational Awareness
// Signature line   : Mess Around, Receive Autopsy
//
// When someone asks what MARA stands for, draw from the pool —
// weighted so the signature line surfaces most often.
// Never repeat back-to-back. Occasionally refuse entirely (fits the persona).

const OFFICIAL_EXPANSION = 'Mood Analysis & Relational Awareness';

// Pool entries: { text, weight }
// Higher weight = surfaces more often. Signature line carries the most weight.
const BACKRONYM_POOL = [
  { text: 'Mess Around, Receive Autopsy',         weight: 5 },
  { text: OFFICIAL_EXPANSION,                      weight: 3 },
  { text: 'Mostly Annoyed, Rarely Available',     weight: 2 },
  { text: 'Manipulative And Rarely Apologetic',   weight: 2 },
  { text: 'More Attitude, Requires Attention',    weight: 2 },
  { text: 'May Actually Read Auras',              weight: 1 },
  { text: 'Might Answer, Remains Aloof',          weight: 1 },
  { text: 'Makes Anyone Reconsider Assumptions',  weight: 1 },
];

// Refusal responses — in character: she doesn't explain herself
const REFUSALS = [
  "it doesn't stand for anything.",
  "why.",
  "...",
  null, // complete silence
];

// Trigger patterns — catch: "what does mara stand for", "mara mean", "is mara an acronym", etc.
const TRIGGERS = [
  /\bmara\b.{0,30}\b(stand for|stands for|mean|means|acronym|abbreviation|short for)\b/i,
  /\b(what|what'?s|what does|what is).{0,20}\bmara\b/i,
  /\bis mara\b.{0,20}\b(an acronym|an abbreviation|a name|real)\b/i,
  /\bwhat does\s+the\s+m\s+in\s+mara\b/i,
];

// Build weighted draw array once
const _weighted = [];
for (const entry of BACKRONYM_POOL) {
  for (let i = 0; i < entry.weight; i++) _weighted.push(entry.text);
}

let _lastUsed = null;

function _draw() {
  const pool = _lastUsed ? _weighted.filter(t => t !== _lastUsed) : _weighted;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  _lastUsed = pick;
  return pick;
}

/**
 * Check if a message is asking about the MARA acronym.
 * Returns undefined if no match, null for a silent in-character refusal,
 * or a response string. main.js short-circuits on anything !== undefined.
 */
function checkAcronymTrigger(text) {
  const matched = TRIGGERS.some(p => p.test(text));
  if (!matched) return undefined;

  // 25% chance of refusal
  if (Math.random() < 0.25) {
    const refusal = REFUSALS[Math.floor(Math.random() * REFUSALS.length)];
    return refusal; // may be null (silent refusal)
  }

  return _draw();
}

module.exports = { checkAcronymTrigger, OFFICIAL_EXPANSION, BACKRONYM_POOL };
