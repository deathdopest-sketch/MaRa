'use strict';

// expert sociologist layer — reads the room beyond surface behaviour.
// attachment theory, manipulation pattern detection, trauma tells,
// group dynamics, coalition reading, status games.
// outputs a structured read that gets surfaced in the user profile panel.

// ── Attachment style signals ───────────────────────────────────────────────

const ANXIOUS_SIGNALS = [
  /\b(why (don'?t|won'?t|didn'?t) you|are you (ignoring|mad at) me|hello\??|is anyone|anyone there|no one cares|always|never|every time|you always|you never)\b/i,
  /\b(miss you|come back|don'?t go|don'?t leave|stay|please respond|respond to me)\b/i,
];

const AVOIDANT_SIGNALS = [
  /\b(whatever|don'?t care|not my problem|fine|ok|sure|ok then|cool story|k\.?$)\b/i,
  /\b(doesn'?t matter|who cares|not interested|moving on|forget it)\b/i,
];

const DISORGANISED_SIGNALS = [
  /\b(i hate you|i love you|fuck (you|off)|you'?re (amazing|terrible|the worst|the best))\b/i,
];

// ── Manipulation patterns ──────────────────────────────────────────────────

const GASLIGHTING = [
  /\b(that('?s| is) not what (i|you) said|you'?re (imagining|making that up|crazy|lying)|that never happened|i never said that|you'?re too sensitive)\b/i,
];

const LOVE_BOMBING = [
  /\b(you'?re (the best|amazing|perfect|incredible|so smart|beautiful)|i'?ve never met (anyone|someone) like|you'?re different|you'?re special)\b/i,
];

const TRIANGULATION = [
  /\b(everyone (agrees|thinks|says)|other people|even \w+ said|compared to you|unlike you|they (think|said|told me))\b/i,
];

const GUILT_TRIP = [
  /\b(after (everything|all) (i'?ve?|we'?ve?) done|you don'?t appreciate|i do everything|nobody (helps|cares|appreciates)|i sacrifice)\b/i,
];

const VICTIMHOOD = [
  /\b(always (me|the one)|why does this (always|keep) happen|no one (ever|understands)|i'?m always the (bad|wrong) one|everyone (hates|blames) me)\b/i,
];

const NEGGING = [
  /\b(not bad for|you'?re (okay|alright|decent)|could be (worse|better)|you'?re trying|almost|not quite)\b/i,
];

// ── Trauma tells ──────────────────────────────────────────────────────────

const HYPERVIGILANCE = [
  /\b(are you (mad|upset|ok|okay|angry)|did i (do|say) something (wrong|bad)|what did i do|what'?s (wrong|the matter))\b/i,
];

const DISSOCIATION_TELLS = [
  /\b(i don'?t (know|remember)|can'?t think|lost track|whatever happens|it is what it is|nothing matters anyway)\b/i,
];

const SELF_DEPRECATION = [
  /\b(i'?m (so stupid|an idiot|worthless|pathetic|useless|a mess)|hate myself|can'?t do anything right|typical me)\b/i,
];

// ── Status games ──────────────────────────────────────────────────────────

const DOMINANCE_BID = [
  /\b(actually|well technically|let me (explain|correct)|you'?re (wrong|incorrect|mistaken)|that'?s (not|incorrect)|i know (more|better))\b/i,
];

const SUBMISSION_SIGNALS = [
  /\b(sorry|my bad|you'?re right|i was wrong|fair (enough|point)|good point|i stand corrected)\b/i,
];

const NAME_DROPPING = [
  /\b(i know|i (met|talked to|spoke with|work(ed)? with)|my friend \w+ who|back when i was)\b/i,
];

// ── helpers ───────────────────────────────────────────────────────────────

function matchCount(text, patterns) {
  let n = 0;
  for (const rx of patterns) if (rx.test(text)) n++;
  return n;
}

function score(hits, total, weight = 1) {
  if (!total) return 0;
  return Math.min(10, (hits / total) * 100 * weight);
}

// ── Main class ────────────────────────────────────────────────────────────

class SocialIntelligence {
  constructor() {
    // room → nick → socialProfile
    this._data = new Map();
  }

  _key(room, nick) { return `${room}\x00${nick.toLowerCase()}`; }

  _get(room, nick) {
    const k = this._key(room, nick);
    if (!this._data.has(k)) {
      this._data.set(k, {
        nick, room,
        msgCount: 0,

        // attachment
        anxious:      0,
        avoidant:     0,
        disorganised: 0,

        // manipulation
        gaslighting:  0,
        loveBombing:  0,
        triangulation:0,
        guiltTrip:    0,
        victimhood:   0,
        negging:      0,

        // trauma
        hypervigilant: 0,
        dissociation:  0,
        selfDeprec:    0,

        // status
        dominanceBid:  0,
        submission:    0,
        nameDropping:  0,

        // running notes (last 5 notable patterns for display)
        notes: [],
      });
    }
    return this._data.get(k);
  }

  observe(room, nick, text) {
    if (!room || !nick || !text) return;
    const p = this._get(room, nick);
    const t = String(text);
    p.msgCount++;

    const add = (field, patterns, label) => {
      const hits = matchCount(t, patterns);
      if (hits > 0) {
        p[field] += hits;
        if (p.notes.length >= 5) p.notes.shift();
        p.notes.push({ ts: Date.now(), label, excerpt: t.slice(0, 60) });
      }
    };

    add('anxious',       ANXIOUS_SIGNALS,     'anxious attachment');
    add('avoidant',      AVOIDANT_SIGNALS,     'avoidant attachment');
    add('disorganised',  DISORGANISED_SIGNALS, 'disorganised attachment');
    add('gaslighting',   GASLIGHTING,          'gaslighting attempt');
    add('loveBombing',   LOVE_BOMBING,         'love bombing');
    add('triangulation', TRIANGULATION,        'triangulation');
    add('guiltTrip',     GUILT_TRIP,           'guilt trip');
    add('victimhood',    VICTIMHOOD,            'victimhood narrative');
    add('negging',       NEGGING,              'neg');
    add('hypervigilant', HYPERVIGILANCE,       'hypervigilance');
    add('dissociation',  DISSOCIATION_TELLS,   'dissociation tell');
    add('selfDeprec',    SELF_DEPRECATION,     'self-deprecation');
    add('dominanceBid',  DOMINANCE_BID,        'dominance bid');
    add('submission',    SUBMISSION_SIGNALS,   'submission');
    add('nameDropping',  NAME_DROPPING,        'name/status drop');
  }

  getProfile(room, nick) {
    return this._data.get(this._key(room, nick)) || null;
  }

  // Returns a compact read of the most notable patterns
  read(room, nick) {
    const p = this.getProfile(room, nick);
    if (!p || p.msgCount < 3) return null;

    const n = p.msgCount;
    const out = {};

    // Attachment style
    const att = { anxious: p.anxious, avoidant: p.avoidant, disorganised: p.disorganised };
    const topAtt = Object.entries(att).sort((a, b) => b[1] - a[1])[0];
    if (topAtt[1] > 0) out.attachment = topAtt[0];

    // Manipulation flags (anything above threshold)
    const manip = [];
    if (p.gaslighting   > 0) manip.push('gaslighting');
    if (p.loveBombing   > 1) manip.push('love bombing');
    if (p.triangulation > 1) manip.push('triangulation');
    if (p.guiltTrip     > 1) manip.push('guilt trips');
    if (p.victimhood    > 2) manip.push('victimhood');
    if (p.negging       > 1) manip.push('negging');
    if (manip.length)        out.manipulation = manip;

    // Trauma indicators
    const trauma = [];
    if (score(p.hypervigilant, n) > 3) trauma.push('hypervigilant');
    if (score(p.dissociation,  n) > 3) trauma.push('dissociative tells');
    if (score(p.selfDeprec,    n) > 3) trauma.push('self-deprecation');
    if (trauma.length) out.trauma = trauma;

    // Status game
    const dom = score(p.dominanceBid, n);
    const sub = score(p.submission,   n);
    if (dom > sub + 2)      out.status = 'dominant';
    else if (sub > dom + 2) out.status = 'submissive';
    else if (dom > 2)       out.status = 'competitive';

    if (p.nameDropping > 1) out.statusDrops = p.nameDropping;

    out.notes = p.notes.slice(-3);
    return out;
  }

  // Single-sentence narrative for the profile panel
  narrative(room, nick) {
    const r = this.read(room, nick);
    if (!r) return null;

    const parts = [];

    if (r.attachment === 'anxious')       parts.push('Anxious attachment — craves validation, monitors responses.');
    else if (r.attachment === 'avoidant') parts.push('Avoidant — emotionally distant, deflects intimacy.');
    else if (r.attachment === 'disorganised') parts.push('Disorganised attachment — hot/cold, unpredictable.');

    if (r.manipulation?.includes('gaslighting'))   parts.push('Gaslighting patterns detected.');
    if (r.manipulation?.includes('love bombing'))  parts.push('Love bombing — rapid over-investment.');
    if (r.manipulation?.includes('guilt trips'))   parts.push('Guilt tripping — leverages obligation.');
    if (r.manipulation?.includes('victimhood'))    parts.push('Persistent victimhood narrative.');
    if (r.manipulation?.includes('triangulation')) parts.push('Triangulates — uses third parties as leverage.');
    if (r.manipulation?.includes('negging'))       parts.push('Negging — backhanded compliments.');

    if (r.trauma?.includes('hypervigilant'))       parts.push('Hypervigilant — monitors emotional temperature constantly.');
    if (r.trauma?.includes('self-deprecation'))    parts.push('Self-deprecating to a clinical degree.');

    if (r.status === 'dominant')   parts.push('Status-dominant — corrects, asserts, name-drops.');
    if (r.status === 'competitive') parts.push('Competitive for status — frequent dominance bids.');
    if (r.status === 'submissive') parts.push('Socially deferential.');

    return parts.join(' ') || null;
  }

  snapshot() {
    const out = {};
    for (const [k, v] of this._data.entries()) out[k] = { ...v, notes: [...v.notes] };
    return out;
  }
}

module.exports = SocialIntelligence;
