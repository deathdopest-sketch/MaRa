'use strict';

// if freddy is reading this dashboard, she already knows who the problems are.

const C = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  magenta:'\x1b[35m',
  white:  '\x1b[37m',
};

function colorEnergy(e) {
  if (e === 'VOLATILE' || e === 'HOT') return C.red + e + C.reset;
  if (e === 'ACTIVE')                  return C.yellow + e + C.reset;
  return C.dim + e + C.reset;
}

function colorTone(t) {
  if (t === 'DRAMA' || t === 'HOSTILE') return C.red + t + C.reset;
  if (t === 'HYPE')                     return C.yellow + t + C.reset;
  if (t === 'SEXUAL')                   return C.magenta + t + C.reset;
  if (t === 'CHILL')                    return C.green + t + C.reset;
  return C.dim + t + C.reset;
}

function colorToneRel(tone) {
  if (tone === 'hostile')     return C.red;
  if (tone === 'friendly')    return C.green;
  if (tone === 'flirty')      return C.magenta;
  if (tone === 'intellectual')return C.cyan;
  return C.dim;
}

function pad(str, n) {
  const s = String(str || '');
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visLen(s) {
  return stripAnsi(s).length;
}

class Dashboard {
  constructor(mood, profiles, relmap, opts = {}) {
    this._mood     = mood;
    this._profiles = profiles;
    this._relmap   = relmap;
    this._rooms    = new Set();
    this._feed     = new Map();   // room → [{ts, nick, text}]
    this._interval = null;
    this._refreshMs = opts.refreshMs || 2000;
  }

  addRoom(room) {
    this._rooms.add(room);
    if (!this._feed.has(room)) this._feed.set(room, []);
  }

  pushFeed(room, nick, text) {
    if (!this._feed.has(room)) this._feed.set(room, []);
    const feed = this._feed.get(room);
    feed.push({ ts: Date.now(), nick, text: String(text || '').slice(0, 120) });
    if (feed.length > 10) feed.shift();
  }

  start() {
    this._draw();
    this._interval = setInterval(() => this._draw(), this._refreshMs);
  }

  stop() {
    clearInterval(this._interval);
  }

  _draw() {
    const cols = process.stdout.columns || 80;
    const W    = Math.min(cols - 2, 100);

    const lines = [];
    const hr    = '═'.repeat(W);
    const thin  = '─'.repeat(W);

    lines.push('\x1b[2J\x1b[H'); // clear

    for (const room of this._rooms) {
      const energy   = this._mood.getEnergy(room);
      const tone     = this._mood.getTone(room);
      const history  = this._mood.getHistory(room).slice(-4);
      const allProf  = this._profiles.getAllProfiles(room);
      const rels     = this._relmap.getRelationships(room).slice(0, 5);
      const tensions = this._relmap.getTensions(room).slice(0, 3);
      const feed     = this._feed.get(room) || [];
      const userCount = allProf.length;

      // header
      const headerContent = `  ☠  MaRa  |  ${C.cyan}${room}${C.reset}  |  ${colorEnergy(energy)}  |  ${colorTone(tone)}  |  ${C.dim}${userCount} users${C.reset}`;
      lines.push(C.dim + '╔' + hr + '╗' + C.reset);
      const padded = pad(stripAnsi(headerContent), W);
      lines.push(C.dim + '║' + C.reset + headerContent + ' '.repeat(Math.max(0, W - visLen(headerContent))) + C.dim + '║' + C.reset);
      lines.push(C.dim + '╠' + hr + '╣' + C.reset);

      // top users
      lines.push(this._sectionLine('TOP USERS', W));
      if (allProf.length === 0) {
        lines.push(this._rowLine(C.dim + '  empty room' + C.reset, W));
      } else {
        for (const p of allProf.slice(0, 5)) {
          const topWords = [...p.topics.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([w])=>w).join(', ');
          const row = `  ${C.cyan}${pad(p.nick, 16)}${C.reset}  ${pad(p.messages + ' msgs', 9)}  ${pad(p.style, 12)}  ${C.dim}${topWords || '—'}${C.reset}`;
          lines.push(this._rowLine(row, W));
        }
      }

      lines.push(C.dim + '╠' + hr + '╣' + C.reset);

      // relationships
      lines.push(this._sectionLine('RELATIONSHIPS', W));
      const shownRels = [...rels];
      for (const t of tensions) {
        if (!shownRels.find(r => r.a === t.a && r.b === t.b)) shownRels.push(t);
      }
      if (!shownRels.length) {
        lines.push(this._rowLine(C.dim + '  none yet' + C.reset, W));
      } else {
        for (const e of shownRels.slice(0, 6)) {
          const tc  = colorToneRel(e.tone);
          const row = `  ${C.cyan}${e.a}${C.reset} ↔ ${C.cyan}${e.b}${C.reset}  ${tc}[${e.tone.toUpperCase()}, ${e.exchangeCount} exchanges]${C.reset}`;
          lines.push(this._rowLine(row, W));
        }
      }

      lines.push(C.dim + '╠' + hr + '╣' + C.reset);

      // live feed
      lines.push(this._sectionLine('LIVE FEED', W));
      if (!feed.length) {
        lines.push(this._rowLine(C.dim + '  listening...' + C.reset, W));
      } else {
        for (const f of feed.slice(-8)) {
          const time = new Date(f.ts).toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit' });
          const row  = `  ${C.dim}${time}${C.reset}  ${C.cyan}${pad(f.nick, 14)}${C.reset}  ${f.text}`;
          lines.push(this._rowLine(row, W));
        }
      }

      lines.push(C.dim + '╠' + hr + '╣' + C.reset);

      // mood history
      const histLine = history.length
        ? history.map(h => `${h.energy}/${h.tone}`).join(' → ')
        : 'no history yet';
      lines.push(this._rowLine(C.dim + '  mood history: ' + histLine + C.reset, W));

      lines.push(C.dim + '╚' + hr + '╝' + C.reset);
      lines.push('');
    }

    if (this._rooms.size === 0) {
      lines.push(C.dim + 'mara is waiting for rooms...' + C.reset);
    }

    process.stdout.write(lines.join('\n'));
  }

  _sectionLine(label, W) {
    const content = ` ${C.dim}${label}${C.reset}`;
    const pad     = ' '.repeat(Math.max(0, W - label.length - 1));
    return C.dim + '║' + C.reset + content + pad + C.dim + '║' + C.reset;
  }

  _rowLine(content, W) {
    const visible = visLen(content);
    const padding = ' '.repeat(Math.max(0, W - visible));
    return C.dim + '║' + C.reset + content + padding + C.dim + '║' + C.reset;
  }
}

module.exports = Dashboard;
