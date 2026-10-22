'use strict';

// she knows exactly who's who. and she never forgets.

const fs   = require('fs');
const path = require('path');

const { think, DWELL_MS } = require('./MaraVoice');

const C = {
  r    : '\x1b[0m',
  dim  : '\x1b[2m',
  bold : '\x1b[1m',
  red  : '\x1b[31m',
  ylw  : '\x1b[33m',
  grn  : '\x1b[32m',
  cyn  : '\x1b[36m',
  mag  : '\x1b[35m',
  wht  : '\x1b[37m',
  home : '\x1b[H',
  hide : '\x1b[?25l',
  show : '\x1b[?25h',
  erase: '\x1b[J',
};

const LEFT_W = 24;

function bar(score, w = 10) {
  const s = Math.max(0, Math.min(10, score || 0));
  const f = Math.round((s / 10) * w);
  return '█'.repeat(f) + '░'.repeat(w - f);
}

function barColor(s) {
  if (s >= 7) return C.red;
  if (s >= 5) return C.ylw;
  return C.grn;
}

function padVis(str, n) {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  if (plain.length >= n) {
    let out = '', vis = 0, i = 0;
    while (i < str.length && vis < n) {
      if (str[i] === '\x1b') {
        const end = str.indexOf('m', i);
        if (end < 0) break;
        out += str.slice(i, end + 1);
        i = end + 1;
      } else { out += str[i++]; vis++; }
    }
    return out + C.r;
  }
  return str + ' '.repeat(n - plain.length);
}

function relAge(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function daysSince(ms) {
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function energyColor(e) {
  if (e === 'HOT' || e === 'VOLATILE') return C.red + e + C.r;
  if (e === 'ACTIVE')                  return C.ylw + e + C.r;
  return C.dim + e + C.r;
}

function toneColor(t) {
  if (t === 'DRAMA' || t === 'HOSTILE') return C.red + t + C.r;
  if (t === 'HYPE')                     return C.ylw + t + C.r;
  if (t === 'SEXUAL')                   return C.mag + t + C.r;
  if (t === 'CHILL')                    return C.grn + t + C.r;
  return C.dim + t + C.r;
}

function relToneColor(tone) {
  if (tone === 'hostile')      return C.red;
  if (tone === 'friendly')     return C.grn;
  if (tone === 'flirty')       return C.mag;
  if (tone === 'intellectual') return C.cyn;
  return C.dim;
}

class Dashboard {
  constructor(mood, profiles, relmap, social, memory, arc, opts = {}) {
    this._mood      = mood;
    this._prof      = profiles;
    this._relmap    = relmap;
    this._social    = social  || null;
    this._memory    = memory  || null;
    this._arc       = arc     || null;
    this._rooms     = [];
    this._roomIdx   = 0;
    this._userIdx   = 0;
    this._feed      = new Map();
    this._interval  = null;
    this._refreshMs = opts.refreshMs || 2000;
    this._dataDir   = process.env.MARA_DATA_DIR || path.join(process.cwd(), 'data');

    // commentary
    this._chat        = [];
    this._dwellStart  = Date.now();
    this._commented   = false;
    this._thinking    = false;
  }

  addRoom(room) {
    if (!this._rooms.includes(room)) this._rooms.push(room);
    if (!this._feed.has(room)) this._feed.set(room, []);
  }

  pushFeed(room, nick, text) {
    if (!this._feed.has(room)) this._feed.set(room, []);
    const feed = this._feed.get(room);
    feed.push({ ts: Date.now(), nick, text: String(text || '').slice(0, 200) });
    if (feed.length > 30) feed.shift();
  }

  pushAlert({ room, level, text }) {
    if (!room) return;
    if (!this._feed.has(room)) this._feed.set(room, []);
    const feed = this._feed.get(room);
    feed.push({ ts: Date.now(), nick: '⚡', text, isAlert: true, level: level || 'info' });
    if (feed.length > 30) feed.shift();
  }

  start() {
    process.stdout.write('\x1b[2J');

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', key => {
        if (key === '\x03' || key === 'q') process.emit('SIGINT');
        if (key === '\x1b[A') { this._userIdx = Math.max(0, this._userIdx - 1); this._resetDwell(); this._draw(); }
        if (key === '\x1b[B') { this._userIdx++; this._resetDwell(); this._draw(); }
        if (key === '\t' || key === '\x1b[C') {
          this._roomIdx = (this._roomIdx + 1) % Math.max(1, this._rooms.length);
          this._userIdx = 0;
          this._resetDwell();
          this._draw();
        }
        if (key === '\x1b[D') {
          this._roomIdx = (this._roomIdx - 1 + this._rooms.length) % Math.max(1, this._rooms.length);
          this._userIdx = 0;
          this._resetDwell();
          this._draw();
        }
        if (key === 'e') {
          const room = this._room();
          const allP = room ? this._prof.getAllProfiles(room) : [];
          const sel  = allP[this._userIdx] || null;
          if (sel) this._exportDossier(sel, room);
        }
      });
    }

    process.stdout.on('resize', () => this._draw());
    this._draw();
    this._interval = setInterval(() => { this._checkDwell(); this._draw(); }, this._refreshMs);
  }

  stop() {
    clearInterval(this._interval);
    process.stdout.write(C.show);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch (_) {}
    }
  }

  _resetDwell() {
    this._dwellStart = Date.now();
    this._commented  = false;
  }

  _checkDwell() {
    if (this._commented || this._thinking) return;
    if (Date.now() - this._dwellStart < DWELL_MS) return;
    const room    = this._room();
    const allProf = room ? this._prof.getAllProfiles(room) : [];
    const sel     = allProf[this._userIdx] || null;
    if (!sel) return;
    this._commented = true;
    this._triggerCommentary(sel, room);
  }

  _triggerCommentary(p, room) {
    if (this._thinking) return;
    this._thinking = true;
    const social   = this._social?.narrative(room, p.nick) || null;
    const arcNarr  = this._arc?.getNarrative(room) || null;
    const mood     = this._mood.getTone(room);
    const roomCtx  = `${room} — room tone: ${mood}${arcNarr ? ` — arc: ${arcNarr}` : ''}`;
    think(p, social, roomCtx)
      .then(text => {
        if (text) {
          this._chat.push({ ts: Date.now(), nick: p.nick, text });
          if (this._chat.length > 20) this._chat.shift();
        }
      })
      .catch(() => {})
      .finally(() => { this._thinking = false; });
  }

  _room() {
    return this._rooms[this._roomIdx] || null;
  }

  _draw() {
    const cols = process.stdout.columns || 100;
    const rows = process.stdout.rows    || 40;
    const W    = Math.max(60, cols - 2);
    const RW   = W - LEFT_W - 1;

    // Fixed-height sections:
    //   3 header lines (top border, main header, arc narrative) + 1 divider = 4
    //   1 feed divider + FEED_H feed rows = FEED_H + 1
    //   1 mara divider + MARA_H mara rows + 1 box bottom + 1 hint = MARA_H + 3
    const FEED_H  = 4;
    const MARA_H  = 3;
    const FIXED   = 5 + FEED_H + 1 + MARA_H + 3;
    const PANEL_H = Math.max(6, rows - FIXED);

    const room = this._room();

    if (!room) {
      const msg = `${C.hide}${C.home}${C.dim}☠  MaRa — waiting for rooms...${C.r}${C.erase}${C.show}`;
      process.stdout.write(msg);
      return;
    }

    const energy     = this._mood.getEnergy(room);
    const tone       = this._mood.getTone(room);
    const allProf    = this._prof.getAllProfiles(room);
    const feed       = (this._feed.get(room) || []).slice(-FEED_H);
    const arcNarr    = this._arc ? this._arc.getNarrative(room) : null;

    if (this._userIdx > Math.max(0, allProf.length - 1)) this._userIdx = Math.max(0, allProf.length - 1);
    const sel = allProf[this._userIdx] || null;

    const out = [C.hide + C.home];

    // ── header ────────────────────────────────────────────────────────────────
    const roomLabel = this._rooms.length > 1
      ? `${room} [${this._roomIdx + 1}/${this._rooms.length}]`
      : room;
    const hdr = `  ☠  MaRa  ·  ${C.cyn}${roomLabel}${C.r}  ·  ${energyColor(energy)}  ·  ${toneColor(tone)}  ·  ${C.dim}${allProf.length} users${C.r}`;
    const arcLine = arcNarr
      ? `  ${C.ylw}◈${C.r}  ${C.dim}${arcNarr}${C.r}`
      : '';
    out.push(`${C.dim}╔${'═'.repeat(W)}╗${C.r}`);
    out.push(`${C.dim}║${C.r}${padVis(hdr, W)}${C.dim}║${C.r}`);
    out.push(`${C.dim}║${C.r}${padVis(arcLine, W)}${C.dim}║${C.r}`);
    out.push(`${C.dim}╠${'═'.repeat(LEFT_W + 1)}╤${'═'.repeat(RW)}╣${C.r}`);

    // ── split panel ───────────────────────────────────────────────────────────
    const left  = this._userListLines(allProf, PANEL_H);
    const right = this._profileLines(sel, room, RW, PANEL_H);

    for (let i = 0; i < PANEL_H; i++) {
      const l = padVis(left[i]  ?? '', LEFT_W);
      const r = padVis(right[i] ?? '', RW);
      out.push(`${C.dim}║${C.r}${l}${C.dim}│${C.r}${r}${C.dim}║${C.r}`);
    }

    // ── feed ──────────────────────────────────────────────────────────────────
    out.push(`${C.dim}╠${'═'.repeat(LEFT_W + 1)}╧${'═'.repeat(RW)}╣${C.r}`);
    if (!feed.length) {
      out.push(`${C.dim}║${C.r}${padVis(`  ${C.dim}listening...${C.r}`, W)}${C.dim}║${C.r}`);
      for (let i = 1; i < FEED_H; i++) {
        out.push(`${C.dim}║${C.r}${' '.repeat(W)}${C.dim}║${C.r}`);
      }
    } else {
      const paddedFeed = feed.slice(-FEED_H);
      while (paddedFeed.length < FEED_H) paddedFeed.unshift(null);
      for (const f of paddedFeed) {
        if (!f) { out.push(`${C.dim}║${C.r}${' '.repeat(W)}${C.dim}║${C.r}`); continue; }
        let row;
        if (f.isAlert) {
          const ac = f.level === 'warn' ? C.red : C.ylw;
          const ts = new Date(f.ts).toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          row = `  ${C.dim}${ts}${C.r}  ${ac}⚡  ${f.text}${C.r}`;
        } else {
          const ts = new Date(f.ts).toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          row = `  ${C.dim}${ts}${C.r}  ${C.cyn}${f.nick.slice(0, 14).padEnd(14)}${C.r}  ${f.text}`;
        }
        out.push(`${C.dim}║${C.r}${padVis(row, W)}${C.dim}║${C.r}`);
      }
    }

    // ── mara commentary ───────────────────────────────────────────────────────
    out.push(`${C.dim}╠${'═'.repeat(W)}╣${C.r}`);
    const recentChat = this._chat.slice(-MARA_H);
    while (recentChat.length < MARA_H) recentChat.unshift(null);

    for (const c of recentChat) {
      if (!c) {
        const hintTxt = this._chat.length === 0
          ? `  ${C.dim}☠  pause on a user for ${Math.round(DWELL_MS / 1000)}s — mara will tell you what she thinks${C.r}`
          : '';
        out.push(`${C.dim}║${C.r}${padVis(hintTxt, W)}${C.dim}║${C.r}`);
        continue;
      }
      const ago = relAge(c.ts);
      const row = `  ${C.mag}☠${C.r}  ${C.dim}${ago}${C.r}  ${C.bold}${c.nick}${C.r}  ${C.dim}${c.text}${C.r}`;
      out.push(`${C.dim}║${C.r}${padVis(row, W)}${C.dim}║${C.r}`);
    }

    out.push(`${C.dim}╚${'═'.repeat(W)}╝${C.r}`);
    out.push(`${C.dim}  [↑↓] select   [←→ tab] room   [e] export dossier   [q] quit${C.r}`);

    out.push(C.erase + C.show);

    process.stdout.write(out.join('\r\n'));
  }

  // ── left panel: user list ─────────────────────────────────────────────────

  _userListLines(allProf, maxH = 40) {
    const lines = [`${C.dim} USERS${C.r}`, ''];
    if (!allProf.length) {
      lines.push(`${C.dim}  empty room${C.r}`);
      return lines;
    }
    const start = Math.max(0, this._userIdx - Math.max(0, maxH - 4));
    for (let i = start; i < allProf.length && lines.length < maxH - 1; i++) {
      const p   = allProf[i];
      const sel = i === this._userIdx;
      const arrow = sel ? `${C.bold}▸${C.r}` : ' ';
      const nick  = sel
        ? `${C.bold}${C.cyn}${p.nick.slice(0, 14)}${C.r}`
        : `${C.dim}${p.nick.slice(0, 14)}${C.r}`;
      const msgs  = `${C.dim}${p.messages}${C.r}`;
      lines.push(` ${arrow} ${nick}  ${msgs}`);
    }
    return lines;
  }

  // ── right panel: user profile ─────────────────────────────────────────────

  _profileLines(p, room, w, maxH = 40) {
    if (!p) {
      return [
        '',
        `${C.dim}  select a user with ↑↓${C.r}`,
        '',
        `${C.dim}  arrow keys navigate the user list${C.r}`,
        `${C.dim}  tab switches rooms${C.r}`,
      ];
    }

    const lines = [];
    const allP  = this._prof.getAllProfiles(room);
    const total = allP.reduce((s, q) => s + q.messages, 0);
    const dom   = total > 0 ? Math.round((p.messages / total) * 100) : 0;
    const vocab = this._prof.vocabRichness?.(p) || '—';

    // ── identity ──────────────────────────────────────────────
    lines.push(`${C.bold} ${p.nick}${C.r}${C.dim}  ·  seen ${daysSince(p.firstSeen)}d  ·  last: ${relAge(p.lastSeen)}${C.r}`);
    lines.push(`${C.dim} ${p.messages} msgs total  session: ${p.sessionMessages || 0}  dom: ${dom}%  vocab: ${vocab}${C.r}`);
    lines.push(`${C.dim} style: ${p.style}  energy: ${p.energy}${p.nickHistory?.length ? `  nicks: ${p.nickHistory.length + 1}` : ''}${C.r}`);
    lines.push('');

    // ── trait bars ────────────────────────────────────────────
    lines.push(`${C.dim} TRAITS${C.r}`);
    lines.push(this._traitBar('Morality    ', p.moralityScore));
    lines.push(this._traitBar('Cunning     ', p.cunningScore));
    lines.push(this._traitBar('Formidable  ', p.formidabilityScore));
    lines.push(this._traitBar('Volatility  ', p.volatilityScore));
    lines.push('');

    // ── tone breakdown ────────────────────────────────────────
    const tPos = p.positiveCount || 0;
    const tNeg = p.negativeCount || 0;
    const tNeu = p.neutralCount  || 0;
    const tTot = tPos + tNeg + tNeu;
    if (tTot > 0) {
      const pct   = (n) => Math.round((n / tTot) * 100);
      const label = tNeg > tPos * 1.5 ? `${C.red}[HOSTILE]${C.r}`
        : tPos > tNeg * 1.5           ? `${C.grn}[FRIENDLY]${C.r}`
        : `${C.dim}[MIXED]${C.r}`;
      lines.push(`${C.dim} TONE${C.r}  ${C.grn}+${pct(tPos)}%${C.r}  ${C.dim}~${pct(tNeu)}%${C.r}  ${C.red}-${pct(tNeg)}%${C.r}   ${label}`);
    } else {
      lines.push(`${C.dim} TONE  no signal yet${C.r}`);
    }
    lines.push('');

    // ── psych profile ─────────────────────────────────────────
    lines.push(`${C.dim} PSYCH${C.r}`);
    const psych = this._buildPsych(p);
    for (const line of this._wrap(psych, w - 2)) {
      lines.push(`${C.dim} ${line}${C.r}`);
    }
    lines.push('');

    // ── social intelligence read ──────────────────────────────
    if (this._social) {
      const narrative = this._social.narrative(room, p.nick);
      if (narrative) {
        lines.push(`${C.mag} SOCIAL READ${C.r}`);
        for (const line of this._wrap(narrative, w - 2)) {
          lines.push(`${C.mag} ${line}${C.r}`);
        }
        lines.push('');
      }
    }

    // ── active arcs ───────────────────────────────────────────
    if (this._arc) {
      const arcs = this._arc.getArcsFor(room, p.nick);
      if (arcs.length) {
        lines.push(`${C.ylw} ARCS${C.r}`);
        for (const a of arcs) {
          const ac = a.confidence >= 7 ? C.red : C.ylw;
          lines.push(` ${ac}◈${C.r} ${C.dim}${a.summary}${C.r}`);
        }
        lines.push('');
      }
    }

    // ── memory: notable past moments ──────────────────────────
    if (this._memory) {
      const episodes = this._memory.getUserEpisodes(p.nick.toLowerCase(), 3);
      if (episodes.length) {
        lines.push(`${C.cyn} MEMORY${C.r}`);
        for (const ep of episodes) {
          const ago = relAge(ep.ts);
          const txt = ep.text.slice(0, w - 10);
          lines.push(`${C.dim} ${ago}  ${txt}${C.r}`);
        }
        lines.push('');
      }
    }

    // ── temporal patterns ─────────────────────────────────────
    if (p.hourCounts?.some(c => c > 0)) {
      const peak = p.hourCounts
        .map((c, h) => ({ h, c }))
        .sort((a, b) => b.c - a.c)
        .slice(0, 3)
        .filter(x => x.c > 0)
        .map(x => `${String(x.h).padStart(2, '0')}:xx ×${x.c}`)
        .join('  ');
      lines.push(`${C.dim} PEAK HOURS  ${peak}${C.r}`);
      lines.push('');
    }

    // ── flags ─────────────────────────────────────────────────
    const flagCounts = {};
    for (const f of (p.flags || [])) {
      flagCounts[f.type] = (flagCounts[f.type] || 0) + 1;
    }
    if (Object.keys(flagCounts).length) {
      lines.push(`${C.ylw} FLAGS${C.r}`);
      for (const [type, count] of Object.entries(flagCounts)) {
        lines.push(`${C.ylw} ⚑ ${type.replace(/_/g, ' ')} ×${count}${C.r}`);
      }
      lines.push('');
    }

    // ── top topics ────────────────────────────────────────────
    const topTopics = [...(p.topics || new Map()).entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w).join(', ');
    if (topTopics) {
      lines.push(`${C.dim} TOPICS  ${topTopics}${C.r}`);
      lines.push('');
    }

    // ── relationships ─────────────────────────────────────────
    const rels = this._relmap.getRelationships(room)
      .filter(e => e.a === p.nick.toLowerCase() || e.b === p.nick.toLowerCase())
      .slice(0, 6);
    if (rels.length) {
      lines.push(`${C.dim} RELATIONSHIPS${C.r}`);
      for (const e of rels) {
        const other = e.a === p.nick.toLowerCase() ? e.b : e.a;
        const tc    = relToneColor(e.tone);
        const sym   = e.tone === 'hostile' ? '✗' : '↔';
        lines.push(` ${tc}${sym}${C.r} ${C.cyn}${other}${C.r}${C.dim}  [${e.tone} · ${e.exchangeCount}ex]${C.r}`);
      }
    }

    return lines.slice(0, maxH);
  }

  _traitBar(label, score) {
    const s  = Math.max(0, Math.min(10, score || 0));
    const bc = barColor(s);
    return ` ${C.dim}${label}${C.r}${bc}${bar(s)}${C.r}${C.dim}  ${s.toFixed(1)}${C.r}`;
  }

  _buildPsych(p) {
    const parts = [];
    const m = p.moralityScore       || 5;
    const c = p.cunningScore        || 3;
    const f = p.formidabilityScore  || 3;
    const v = p.volatilityScore     || 3;

    if (m < 2)      parts.push('Openly hostile. Uses slurs or threats.');
    else if (m < 4) parts.push('Frequently aggressive. Limited filter.');
    else if (m < 6) parts.push('Context-dependent. Mixed signals.');
    else if (m < 8) parts.push('Generally positive in exchanges.');
    else            parts.push('Consistently kind and supportive.');

    if (c > 7)      parts.push('Highly evasive — deflects, rarely commits to a position.');
    else if (c > 5) parts.push('Prefers vague answers. Asks more than tells.');

    if (f > 7)      parts.push('Commands attention. Others respond to them.');
    else if (f > 5) parts.push('Moderate social footprint.');
    else if (f < 3) parts.push('Low footprint — rarely acknowledged.');

    if (v > 7)      parts.push('Unpredictable. Mood swings rapidly within a session.');
    else if (v > 5) parts.push('Emotionally inconsistent.');

    if ((p.aggressionSpikes    || 0) > 2) parts.push(`${p.aggressionSpikes} documented aggression spikes.`);
    if ((p.directedHostility   || 0) > 0) parts.push(`Directed hostility at owner ×${p.directedHostility}.`);
    if ((p.batchCount          || 0) > 3) parts.push('Message batcher — fragments thoughts across rapid short bursts.');
    if ((p.storyStatements     || []).length > 3) parts.push('Multiple recorded claims — monitor for contradictions.');

    return parts.join(' ') || 'Insufficient data for profile.';
  }

  _wrap(text, w) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
      if ((cur + ' ' + word).trim().length > w) {
        if (cur) lines.push(cur);
        cur = word;
      } else {
        cur = (cur + ' ' + word).trim();
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ── dossier export ────────────────────────────────────────────────────────

  _exportDossier(p, room) {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      const ts   = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(this._dataDir, `dossier_${p.nick}_${ts}.txt`);
      const hr   = '─'.repeat(60);
      const lines = [];

      lines.push(`MARA DOSSIER — ${p.nick}`);
      lines.push(`Room: ${room}  ·  Exported: ${new Date().toLocaleString()}`);
      lines.push(hr);
      lines.push('');
      lines.push(`Messages: ${p.messages}  Session: ${p.sessionMessages || 0}  Style: ${p.style}  Energy: ${p.energy}`);
      lines.push(`First seen: ${new Date(p.firstSeen).toLocaleString()}  Last active: ${new Date(p.lastSeen).toLocaleString()}`);
      if (p.nickHistory?.length) {
        lines.push(`Nick history: ${p.nickHistory.map(n => n.nick).join(' → ')}`);
      }
      lines.push('');

      lines.push('TRAITS');
      lines.push(`  Morality:    ${(p.moralityScore      || 0).toFixed(1)}/10`);
      lines.push(`  Cunning:     ${(p.cunningScore       || 0).toFixed(1)}/10`);
      lines.push(`  Formidable:  ${(p.formidabilityScore || 0).toFixed(1)}/10`);
      lines.push(`  Volatility:  ${(p.volatilityScore    || 0).toFixed(1)}/10`);
      lines.push('');

      const tPos = p.positiveCount || 0, tNeg = p.negativeCount || 0, tNeu = p.neutralCount || 0;
      const tTot = tPos + tNeg + tNeu;
      if (tTot > 0) {
        const pct = n => Math.round((n / tTot) * 100);
        lines.push(`TONE  +${pct(tPos)}% positive  ~${pct(tNeu)}% neutral  -${pct(tNeg)}% negative`);
        lines.push('');
      }

      if (this._social) {
        const narrative = this._social.narrative(room, p.nick);
        if (narrative) {
          lines.push('SOCIAL READ');
          lines.push(`  ${narrative}`);
          lines.push('');
        }
      }

      if (this._arc) {
        const arcs = this._arc.getArcsFor(room, p.nick);
        if (arcs.length) {
          lines.push('ACTIVE ARCS');
          for (const a of arcs) {
            lines.push(`  [${a.type}] conf: ${a.confidence.toFixed(1)}  ${a.summary}`);
          }
          lines.push('');
        }
      }

      const flagCounts = {};
      for (const f of (p.flags || [])) flagCounts[f.type] = (flagCounts[f.type] || 0) + 1;
      if (Object.keys(flagCounts).length) {
        lines.push('FLAGS');
        for (const [type, count] of Object.entries(flagCounts)) {
          lines.push(`  ⚑ ${type.replace(/_/g, ' ')} ×${count}`);
        }
        lines.push('');
      }

      if (p.hourCounts?.some(c => c > 0)) {
        const peak = p.hourCounts
          .map((c, h) => ({ h, c }))
          .sort((a, b) => b.c - a.c)
          .slice(0, 5)
          .filter(x => x.c > 0)
          .map(x => `${String(x.h).padStart(2, '0')}:00 (${x.c} msgs)`)
          .join('  ');
        lines.push(`PEAK HOURS  ${peak}`);
        lines.push('');
      }

      const topTopics = [...(p.topics || new Map()).entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w).join(', ');
      if (topTopics) {
        lines.push(`TOPICS  ${topTopics}`);
        lines.push('');
      }

      if (this._memory) {
        const episodes = this._memory.getUserEpisodes(p.nick.toLowerCase(), 10);
        if (episodes.length) {
          lines.push('MEMORY EPISODES');
          for (const ep of episodes) {
            lines.push(`  ${new Date(ep.ts).toLocaleString()}  ${ep.text.slice(0, 120)}`);
          }
          lines.push('');
        }
      }

      const rels = this._relmap.getRelationships(room)
        .filter(e => e.a === p.nick.toLowerCase() || e.b === p.nick.toLowerCase());
      if (rels.length) {
        lines.push('RELATIONSHIPS');
        for (const e of rels) {
          const other = e.a === p.nick.toLowerCase() ? e.b : e.a;
          lines.push(`  ${e.tone === 'hostile' ? '✗' : '↔'} ${other}  [${e.tone} · ${e.exchangeCount} exchanges]`);
        }
        lines.push('');
      }

      fs.writeFileSync(file, lines.join('\n'));
      this.pushFeed(room, '☠', `dossier → ${path.basename(file)}`);
    } catch (e) {
      this.pushFeed(room, '☠', `export failed: ${e.message}`);
    }
  }
}

module.exports = Dashboard;
