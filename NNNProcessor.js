'use strict';

const fs   = require('fs');
const path = require('path');

// NNNProcessor — Mara 32D + Lunchbox 16-bank Adaptive PNN architecture
// Upgraded from intellinoid_nnn.vita (The Lunchbox / DeathAIAUS)
// VITABIOWORKSHOP scale: 32D → 16-bank PNN (40%) + 8-ring Staggered NCNN (60%) → NNN ×1.25
//
// Architecture: Text → Feature Extraction (32D) → 16-Bank Adaptive PNN (40%)
//               → Staggered Circular Rings NCNN 8-ring/5-cycle (60%)
//               → NNN Fusion (×1.25 synergy)
//               → contextType + toneInfluence + botRisk + score + mode flags
//
// Staggered Circular Rings: 8 rings × 4 positions, stagger boost ×1.5 at positions 1 & 2
// (from VITABIOWORKSHOP staggered_circular_rings model — 241.73% → NNN synergy 282.86%)
//
// Feature Dimensions (32D):
//   ── Base 16D (unchanged from v1) ──
//   0  word count density (0..1 at 50 words)
//   1  char length density (0..1 at 200 chars)
//   2  emotional intensity (!!! / omg / wtf / fuck)
//   3  caps ratio
//   4  social markers (omg/bestie/literally/fr/lol/lmao/ngl)
//   5  emotional depth (feel/hurt/miss/lonely/scared/sad/crying/depressed)
//   6  code/tech markers (code/function/bug/deploy/git/server/npm/error/node/socket/js/py)
//   7  authority challenge (prove it/who are you/what are you/bot/fake/not real/ai)
//   8  D-D/Death recognition (death/d-d/kenneth/my guy/daddy/boss)
//   9  surveillance triggers (notice/watching/log/track/who said/earlier/remember)
//  10  question complexity (why/how/what do you think/explain/thoughts on)
//  11  personal pronoun density (I/me/my)
//  12  music depth (genre/artist markers)
//  13  authority tone (demand/command/order pattern)
//  14  manipulation detection (love bomb/triangulation/gaslighting/negging patterns)
//  15  dark culture (goth/gothic/punk/metal/dark/void/death/shadow/occult)
//   ── Extended 16D (VITABIOWORKSHOP scale) ──
//  16  grammar_formality (complete sentences vs fragments)
//  17  rhetorical_question ("right? / isn't it? / you know?")
//  18  hostility_aggression (direct insults / "fuck you / get out / go away")
//  19  music_genre_depth (specific genre names vs generic "music")
//  20  intimacy_vulnerability ("I've never told anyone / only you / scared to say")
//  21  humor_sarcasm ("lol jk / sure totally / oh yeah definitely / 🙃")
//  22  approval_seeking ("do you like me / am I ok / was that good / did I do good")
//  23  power_dynamics (submission markers: "please / sorry / is it ok if / may I")
//  24  trust_loyalty ("I trust / I believe in you / always be there / count on you")
//  25  repetition_fixation (same phrase/name repeated 2+ times)
//  26  creative_artistic ("I made / I drew / I wrote / my art / my music / my work")
//  27  existential_mortality ("point of it all / nothing matters / going to die / why exist")
//  28  tech_depth (deep terms: regex/recursion/onnx/kernel/bytecode/syscall/endianness)
//  29  roleplay_fiction ("pretend / let's say / in this scenario / as a character / rp")
//  30  meta_self_reference ("you just said / earlier you / that's what you always / you told me")
//  31  brevity_signal (< 5 words — attention-grab / one-liner)

class NNNProcessor {

  constructor() {
    // ── Lunchbox 16-bank adaptive PNN (expanded from 8-bank v1) ─────────────
    // Pattern extended: same ramp × 2 cycles across 16 banks
    this._pnn_left  = [0.90, 0.99, 1.08, 1.17, 1.26, 1.35, 1.44, 1.53,
                       0.90, 0.99, 1.08, 1.17, 1.26, 1.35, 1.44, 1.53];
    this._pnn_right = [0.85, 0.94, 1.03, 1.11, 1.20, 1.28, 1.37, 1.45,
                       0.85, 0.94, 1.03, 1.11, 1.20, 1.28, 1.37, 1.45];
    this._pnn_efficiency  = 0.95;
    this._pnn_adapt_rate  = 0.01;
    this._inference_count = 0;

    // ── NCNN — 8-ring Staggered Circular Rings (VITABIOWORKSHOP scale) ───────
    // Transfer drops to 0.80 for staggered model (vs 0.85 for sequential)
    // Stagger triggers at ring positions 1 and 2 (≈1/3 and 2/3) with ×1.5 boost
    this._ncnn_transfer      = 0.80;
    this._ncnn_momentum      = 1.015;
    this._ncnn_momentum_cap  = 1.6;
    this._ncnn_energy_loss   = 0.95;
    this._ncnn_cycles        = 5;
    this._ncnn_stagger_pos   = new Set([1, 2]);  // stagger boost positions
    this._ncnn_stagger_boost = 1.5;

    // ── NNN Fusion ────────────────────────────────────────────────────────────
    this._pnn_weight    = 0.4;
    this._ncnn_weight   = 0.6;
    this._synergy_bonus = 1.25;

    // ── Mara-specific amplifiers ──────────────────────────────────────────────
    this._tech_amp        = 1.4;
    this._authority_amp   = 1.5;
    this._dd_amp          = 2.0;
    this._manip_amp       = 1.6;
    this._dark_amp        = 1.3;
    this._emotional_amp   = 1.2;
    this._bot_risk_amp    = 1.5;
    this._hostility_amp   = 1.8;   // D18
    this._intimacy_amp    = 1.4;   // D20

    // ── Mood state ────────────────────────────────────────────────────────────
    this.mood_cool       = 0.7;
    this.mood_dark       = 0.4;
    this.mood_deflective = 0.05;

    // ── Fused cap baseline (precomputed) ──────────────────────────────────────
    this._fusedCapMean = this._computeFusedCapMean();

    // ── Weight persistence ────────────────────────────────────────────────────
    const dataDir = process.env.MARA_DATA_DIR
      || path.join(__dirname, 'data');
    this._weightsPath = path.join(dataDir, 'MaraMemory', 'nnn_weights.json');
    this._loadWeights();
  }

  _loadWeights() {
    try {
      if (!fs.existsSync(this._weightsPath)) return;
      const saved = JSON.parse(fs.readFileSync(this._weightsPath, 'utf8'));
      // Accept both 8-bank (legacy) and 16-bank saves
      if (Array.isArray(saved.left)) {
        if (saved.left.length === 16) {
          this._pnn_left  = saved.left;
          this._pnn_right = saved.right;
        } else if (saved.left.length === 8) {
          // Migrate: double the banks
          this._pnn_left  = [...saved.left,  ...saved.left];
          this._pnn_right = [...saved.right, ...saved.right];
        }
      }
      if (typeof saved.inferences === 'number') this._inference_count = saved.inferences;
      this._fusedCapMean = this._computeFusedCapMean();
    } catch { /* first boot or corrupt — use defaults */ }
  }

  _saveWeights() {
    try {
      const dir = path.dirname(this._weightsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._weightsPath, JSON.stringify({
        left: this._pnn_left, right: this._pnn_right, inferences: this._inference_count,
      }));
    } catch { /* non-fatal */ }
  }

  _computeFusedCapMean() {
    const maxNcnn = this._ncnn_momentum_cap * this._ncnn_cycles * 0.1;
    let sum = 0;
    for (let i = 0; i < 32; i++) {
      const bank = i % 16;
      const maxPnn = this._pnn_efficiency *
        (this._pnn_left[bank] + this._pnn_right[bank]) * 0.5;
      sum += Math.max(
        (maxPnn * this._pnn_weight + maxNcnn * this._ncnn_weight) * this._synergy_bonus,
        0.001
      );
    }
    return sum / 32;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setMood(cool, dark, deflective) {
    this.mood_cool       = Math.max(0, Math.min(1, cool));
    this.mood_dark       = Math.max(0, Math.min(1, dark));
    this.mood_deflective = Math.max(0, Math.min(1, deflective));
  }

  process(text) {
    const feat  = this._extractFeatures(text || '');
    const pnn   = this._runPNN(feat);
    const ncnn  = this._runNCNN(feat);
    const result = this._fuse(feat, pnn, ncnn);
    this._adapt(feat);
    return result;
  }

  // ── Feature Extraction (32D) ────────────────────────────────────────────────

  _extractFeatures(text) {
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean);
    const wc    = words.length;
    const cc    = text.length;

    // ── D0–D15: base dimensions (unchanged from v1) ───────────────────────────

    const d0 = Math.min(wc / 50, 1.0);
    const d1 = Math.min(cc / 200, 1.0);

    const excl    = (text.match(/!/g) || []).length;
    const intHits = (lower.match(/\b(omg|wtf|fuck|shit|damn|holy|wow|jesus)\b/g) || []).length;
    const d2 = Math.min(excl * 0.2 + intHits * 0.4, 1.0);

    const caps = (text.match(/[A-Z]/g) || []).length;
    const d3 = cc > 0 ? Math.min(caps / cc, 1.0) : 0;

    const soc = (lower.match(/\b(omg|bestie|literally|fr|lol|lmao|ngl|imo|tbh|idk|rn|lowkey|highkey|vibe|slay|periodt)\b/g) || []).length;
    const d4 = Math.min(soc * 0.25, 1.0);

    const dep = (lower.match(/\b(feel|hurt|miss|lonely|scared|sad|crying|depressed|broken|empty|numb|lost|anxious|worried|afraid)\b/g) || []).length;
    const d5 = Math.min(dep * 0.3, 1.0);

    const tech = (lower.match(/\b(code|function|bug|deploy|git|server|npm|error|node|socket|javascript|js|python|py|api|database|db|repo|commit|branch|css|html|react|express|route|endpoint|crash|undefined|null|async|await|callback|module|class|import|export|install|build|run|compile|typescript|ts|env|config|pm2|nginx|docker)\b/g) || []).length;
    const d6 = Math.min(tech * 0.18, 1.0);

    const chal = (lower.match(/\b(prove|who are you|what are you|bot|fake|not real|ai|robot|chatgpt|gpt|claude|artificial|program|script|automated|liar)\b/g) || []).length;
    const directAcc = /\b(are you (a )?bot|you('re| are) a? ?bot|prove you('re| are) (human|real)|you'?re? (not|fake|ai|a bot))\b/.test(lower);
    const d7 = Math.min(chal * 0.3 + (directAcc ? 0.6 : 0), 1.0);

    const ddDirect  = (lower.match(/\b(d-d|kenneth|my guy|daddy)\b/g) || []).length;
    const deathAddr = /(?:^|hey\s|hi\s|yo\s|@)\s*death\b/.test(lower) ? 1 : 0;
    const d8 = Math.min((ddDirect + deathAddr) * 0.4, 1.0);

    const surv = (lower.match(/\b(notice|watching|log|track|remember|who said|earlier|before|saw|seen|heard|know|aware|intel|info|data|profile)\b/g) || []).length;
    const d9 = Math.min(surv * 0.2, 1.0);

    const cxq = (lower.match(/\b(why|how|what do you think|explain|thoughts on|opinion|what about|what if|do you think|what would)\b/g) || []).length;
    const d10 = Math.min(cxq * 0.3, 1.0);

    const pron = (lower.match(/\b(i|me|my|myself|mine)\b/g) || []).length;
    const d11 = wc > 0 ? Math.min(pron / wc * 3, 1.0) : 0;

    const mus = (lower.match(/\b(cure|bauhaus|siouxsie|chelsea wolfe|nick cave|dead can dance|nine inch nails|nin|rammstein|ministry|kmfdm|slipknot|mcr|my chemical|paramore|nirvana|metallica|tool|portishead|massive attack|tricky|bjork|pj harvey|hole|evanescence|black metal|death metal|gothic|darkwave|post-punk|industrial|ambient|grunge|emo|punk|metal|hardcore|shoegaze|doom|goth)\b/g) || []).length;
    const d12 = Math.min(mus * 0.3, 1.0);

    const cmd = (lower.match(/\b(do this|tell me|give me|show me|make me|you will|you must|you have to|i need you to|i want you to|listen|obey|comply|answer me)\b/g) || []).length;
    const d13 = Math.min(cmd * 0.35, 1.0);

    const manip = (lower.match(/\b(you'?re? the only|no one else|always|never leave|you (have|owe) (me|us)|after all i|i thought we|i trusted you|why don'?t you ever|you always|you never|if you really|prove you care|jealous|testing you|playing games|gaslighting|love bomb|negging)\b/g) || []).length;
    const d14 = Math.min(manip * 0.4, 1.0);

    const dark = (lower.match(/\b(goth|gothic|punk|metal|dark|darkness|void|shadow|occult|death|decay|cryptic|sinister|morbid|macabre|haunted|cursed|blackened|nihilism|existential|abyss|hex|ritual|witchcraft|cemetery|graveyard|velvet|lace|corset|leather|boots|chains|pale|ethereal|eldritch)\b/g) || []).length;
    const d15 = Math.min(dark * 0.2, 1.0);

    // ── D16–D31: extended Mara-specific dimensions ────────────────────────────

    // D16 — grammar formality: sentence-ending punctuation + conjunctions
    const sentences = (text.match(/[.!?]/g) || []).length;
    const conjunc   = (lower.match(/\b(because|therefore|however|although|whereas|furthermore|nevertheless)\b/g) || []).length;
    const d16 = Math.min(sentences * 0.2 + conjunc * 0.3, 1.0);

    // D17 — rhetorical question / tag question
    const rhetorical = (lower.match(/\b(right\?|isn'?t it\?|don'?t you think|you know\?|am i right|obviously|clearly|of course)\b/g) || []).length;
    const tagQ = (text.match(/,\s*(right|yeah|no|huh)\?/g) || []).length;
    const d17 = Math.min(rhetorical * 0.35 + tagQ * 0.4, 1.0);

    // D18 — hostility / aggression
    const hostile = (lower.match(/\b(fuck you|go away|shut up|get out|hate you|idiot|moron|stupid|dumb|worthless|pathetic|useless|piece of|trash|garbage|screw you|piss off|leave me alone)\b/g) || []).length;
    const d18 = Math.min(hostile * 0.5, 1.0);

    // D19 — music genre depth (specific genre names, not just artist names)
    const genreDeep = (lower.match(/\b(black metal|death metal|doom metal|post-punk|darkwave|shoegaze|dreampop|gothic rock|industrial metal|noise rock|grindcore|funeral doom|drone metal|ethereal wave|coldwave|neoclassical darkwave|neofolk|dungeon synth|ambient black metal|blackgaze)\b/g) || []).length;
    const d19 = Math.min(genreDeep * 0.4, 1.0);

    // D20 — intimacy / vulnerability
    const intimacy = (lower.match(/\b(never told anyone|only you|just you|scared to say|can i trust|vulnerable|opening up|hard to say|don'?t usually|you'?re? the first|feeling exposed|raw|honest with you|real with you)\b/g) || []).length;
    const d20 = Math.min(intimacy * 0.45, 1.0);

    // D21 — humor / sarcasm
    const sarc = (lower.match(/\b(lol jk|just kidding|sure totally|oh yeah definitely|wow great|how wonderful|totally not|obviously not|not at all|sarcasm|irony|definitely don'?t|sure sure)\b/g) || []).length;
    const d21 = Math.min(sarc * 0.4, 1.0);

    // D22 — approval seeking
    const approval = (lower.match(/\b(do you like me|am i ok|was that ok|did i do (good|well)|am i (good|bad)|what do you think of me|do you think i'm|am i (right|wrong)|am i (boring|interesting|funny|weird))\b/g) || []).length;
    const d22 = Math.min(approval * 0.5, 1.0);

    // D23 — power dynamics / submission
    const submit = (lower.match(/\b(please|sorry|i'm sorry|excuse me|may i|is it ok if|would it be ok|i hope that'?s ok|i didn'?t mean to|forgive me|i apologize|don'?t be mad)\b/g) || []).length;
    const d23 = Math.min(submit * 0.22, 1.0);

    // D24 — trust / loyalty language
    const trust = (lower.match(/\b(i trust (you|this)|i believe in (you|this)|always be there|count on (you|this)|loyal|trustworthy|reliable|you'?ve? never let me down|you always come through|i know you will)\b/g) || []).length;
    const d24 = Math.min(trust * 0.45, 1.0);

    // D25 — repetition / fixation (same word 3+ times)
    const allWords = lower.split(/\s+/).filter(w => w.length > 3);
    const wordFreq = {};
    for (const w of allWords) wordFreq[w] = (wordFreq[w] || 0) + 1;
    const maxRepeat = Math.max(0, ...Object.values(wordFreq)) - 2;  // 0 if no repeats
    const d25 = Math.min(maxRepeat * 0.3, 1.0);

    // D26 — creative / artistic expression
    const creative = (lower.match(/\b(i made|i drew|i painted|i wrote|i created|my art|my music|my drawing|my story|my poem|my work|my design|i designed|i built|i composed|my project)\b/g) || []).length;
    const d26 = Math.min(creative * 0.45, 1.0);

    // D27 — existential / mortality themes
    const exist = (lower.match(/\b(point of (it all|this|life|existence)|nothing matters|why (exist|bother|go on|live)|going to die|end of (it|everything)|no point|meaningless|empty inside|just want it to end|what'?s the point)\b/g) || []).length;
    const d27 = Math.min(exist * 0.5, 1.0);

    // D28 — tech depth (deep/specific terms beyond surface coding markers)
    const techDeep = (lower.match(/\b(regex|recursion|onnx|kernel|bytecode|syscall|endianness|heap|stack overflow|pointer|reference|dereference|garbage collection|gc|jit|aot|ast|lexer|parser|tokenize|emit|compile|transpile|llm|embedding|inference|quantize|gradient|backprop|tensor|cuda|gpu|wasm|webassembly|shim|polyfill|monkeypatch|memoize|debounce|throttle|mutex|semaphore|deadlock|race condition)\b/g) || []).length;
    const d28 = Math.min(techDeep * 0.35, 1.0);

    // D29 — roleplay / fiction signal
    const rp = (lower.match(/\b(pretend|let'?s say|in this scenario|as a character|roleplay|rp|playing as|my character|your character|in the story|in this world|hypothetically speaking|imagine if|what if you were|act as)\b/g) || []).length;
    const d29 = Math.min(rp * 0.4, 1.0);

    // D30 — meta / self-reference (referencing Mara's own prior output)
    const meta = (lower.match(/\b(you just said|you said (that|earlier|before)|earlier you|you told me|that'?s what you (always|said|told)|you admitted|you confirmed|you claimed|you were saying|but you said)\b/g) || []).length;
    const d30 = Math.min(meta * 0.5, 1.0);

    // D31 — brevity signal (< 5 words = attention grab)
    const d31 = wc < 5 ? Math.min(1.0 - wc * 0.18, 1.0) : 0;

    return [
      d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14, d15,
      d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29, d30, d31,
    ];
  }

  // ── 16-Bank Adaptive PNN — CLACK-SWING-CLACK (Lunchbox architecture) ────────

  _runPNN(feat) {
    const out = new Array(32).fill(0);
    for (let i = 0; i < 32; i++) {
      const bank  = i % 16;
      const clack1 = feat[i] * this._pnn_left[bank];
      const swing  = clack1 * this._pnn_efficiency;
      const adapt  = 1.0 + bank * this._pnn_adapt_rate * 0.1;
      out[i] = swing * this._pnn_right[bank] * adapt;
    }
    return out;
  }

  // ── 8-Ring Staggered Circular Rings NCNN ─────────────────────────────────────
  // 8 rings × 4 positions mapping all 32 dimensions.
  // Stagger boost ×1.5 at positions 1 and 2 (≈1/3 and ≈2/3 of ring).
  // Matches VITABIOWORKSHOP staggered_circular_rings_models architecture.

  _runNCNN(feat) {
    const rings = [
      [0,  8, 16, 24],   // ring 1 — 0°
      [1,  9, 17, 25],   // ring 2 — 45°
      [2, 10, 18, 26],   // ring 3 — 90°
      [3, 11, 19, 27],   // ring 4 — 135°
      [4, 12, 20, 28],   // ring 5 — 180°
      [5, 13, 21, 29],   // ring 6 — 225°
      [6, 14, 22, 30],   // ring 7 — 270°
      [7, 15, 23, 31],   // ring 8 — 315°
    ];

    const out = new Array(32).fill(0);

    for (const ring of rings) {
      for (let cycle = 0; cycle < this._ncnn_cycles; cycle++) {
        let momentum = 1.0;
        for (let step = 0; step < ring.length; step++) {
          const idx     = ring[step];
          const nextIdx = ring[(step + 1) % ring.length];

          // Stagger boost at trigger positions
          const boost = this._ncnn_stagger_pos.has(step) ? this._ncnn_stagger_boost : 1.0;
          const transfer = feat[idx] * this._ncnn_transfer * momentum * boost;

          out[idx]     += transfer;
          out[nextIdx] += transfer * this._ncnn_energy_loss;

          momentum = Math.min(momentum * this._ncnn_momentum, this._ncnn_momentum_cap);
        }
      }
    }

    for (let i = 0; i < 32; i++) out[i] /= this._ncnn_cycles;
    return out;
  }

  // ── NNN Fusion + Interpretation ────────────────────────────────────────────

  _fuse(feat, pnn, ncnn) {
    const maxNcnn = this._ncnn_momentum_cap * this._ncnn_cycles * 0.1;
    const fused   = new Array(32);

    for (let i = 0; i < 32; i++) {
      const bank   = i % 16;
      const maxPnn = this._pnn_efficiency * (this._pnn_left[bank] + this._pnn_right[bank]) * 0.5;
      const cap    = Math.max(
        (maxPnn * this._pnn_weight + maxNcnn * this._ncnn_weight) * this._synergy_bonus,
        0.001
      );
      const raw  = (pnn[i] * this._pnn_weight + ncnn[i] * this._ncnn_weight) * this._synergy_bonus;
      fused[i] = Math.min(raw / cap, 1.0);
    }

    // With 32D, arithmetic mean is diluted by the many near-zero dimensions.
    // Use hot-dim mean (only dims > 0.05) to avoid dilution, combined with
    // the peak amplified signal rather than the average.
    const hotDims = fused.filter(v => v > 0.05);
    const mean    = hotDims.length
      ? hotDims.reduce((s, v) => s + v, 0) / hotDims.length
      : fused.reduce((s, v) => s + v, 0) / 32;

    const peakAmp = Math.max(
      fused[5]  * this._emotional_amp,
      fused[6]  * this._tech_amp,
      fused[7]  * this._authority_amp,
      fused[8]  * this._dd_amp,
      fused[14] * this._manip_amp,
      fused[15] * this._dark_amp,
      fused[18] * this._hostility_amp,
      fused[20] * this._intimacy_amp,
    );

    const score = Math.min((mean + peakAmp / 2) / 2, 1.0);

    let contextType = 'lurk';
    if (score > 0.35) contextType = 'present';
    if (score > 0.55) contextType = 'engage';

    return {
      contextType,
      score,
      fused,
      // ── existing output fields (unchanged) ───────────────────────────────
      botRisk            : fused[7] * this._bot_risk_amp,
      flirtMode          : fused[8] > 0.15,
      techMode           : fused[6] > 0.18,
      intelMode          : fused[9] > 0.15,
      authorityChallenge : fused[7] > 0.2,
      manipDetected      : fused[14] > 0.22,
      darkMode           : fused[15] > 0.18,
      musicMode          : fused[12] > 0.18,
      toneInfluence: {
        cool       : this.mood_cool + fused[0] * 0.2,
        dark       : this.mood_dark + fused[15] * 0.3 + fused[5] * 0.1,
        deflective : this.mood_deflective + fused[7] * 0.4,
        sharp      : fused[7] * 0.5 + fused[13] * 0.3,
        flirty     : fused[8] * 0.8 + fused[4] * 0.15,
      },
      // ── new 32D-derived fields ────────────────────────────────────────────
      hostility      : fused[18] * this._hostility_amp,
      intimacy       : fused[20] * this._intimacy_amp,
      creativeSignal : fused[26] > 0.15,
      existential    : fused[27] > 0.12,
      techDepth      : fused[28] > 0.20,
      roleplaySignal : fused[29] > 0.18,
    };
  }

  // ── Lunchbox self-adaptation: nudge bank weights toward hot features ────────

  _adapt(feat) {
    this._inference_count++;
    if (this._inference_count % 10 !== 0) return;

    for (let bank = 0; bank < 16; bank++) {
      // Two dims per bank in 32D space: dim=bank and dim=bank+16
      const avg = (feat[bank] + feat[bank + 16]) / 2;
      const nudge = avg * this._pnn_adapt_rate * 0.01;
      this._pnn_left[bank]  = Math.min(Math.max(this._pnn_left[bank]  + nudge, 0.5), 2.5);
      this._pnn_right[bank] = Math.min(Math.max(this._pnn_right[bank] + nudge, 0.5), 2.5);
    }

    this._fusedCapMean = this._computeFusedCapMean();

    if (this._inference_count % 100 === 0) this._saveWeights();
  }

  getBankWeights() {
    return { left: [...this._pnn_left], right: [...this._pnn_right], inferences: this._inference_count };
  }
}

module.exports = NNNProcessor;
