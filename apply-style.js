'use strict';
// Run once after mara account is restored: node apply-style.js
require('dotenv').config();

const WebSocket = require('ws');
const crypto    = require('crypto');

const username    = process.env.MARA_CC_USERNAME;
const password    = process.env.MARA_CC_PASSWORD;
const fingerprint = crypto.createHash('sha256').update('spackle-cc:' + username).digest('hex');

let authed = false; let done = false;

const ws = new WebSocket('wss://ws.chatcommon.com/', {
  headers: {
    'Origin'    : 'https://chatcommon.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
});

function send(obj) { ws.send(JSON.stringify(obj)); }

ws.on('open', () => {
  console.log('[apply-style] connected');
  send({ type: 'client_identify', fingerprint });
  send({ type: 'login', username, password, stealth: false, fingerprint });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'ping') { send({ type: 'pong', timestamp: msg.timestamp }); return; }

  if (msg.type === 'login_success') {
    console.log('[apply-style] login role=' + msg.role + ' token=' + !!(msg.session_token));
    if (msg.role === 'Guest' && msg.session_token && !authed) {
      authed = true;
      send({ type: 'login', username, session_token: msg.session_token, is_logged_in: true, fingerprint });
    } else if (msg.role !== 'Guest' && !done) {
      done = true;
      console.log('[apply-style] Subscriber — applying profile + style...');

      // Nickname + bio + location
      send({ type: 'update_profile',
        nickname : '⚡ MaRa',
        bio      : 'she/her · quiet type · been here longer than you',
        location : 'Cyberpunk City',
      });

      // Dark charcoal → silver gradient on name, silver glow, glitch, font gradient
      send({ type: 'update_profile',
        // name: dark charcoal → silver gradient
        hasNameGradient        : true,
        nameColor              : '#888888',
        nameColorGradientStart : '#2A2A2A',
        nameColorGradientEnd   : '#C0C0C0',
        hasNameGlow            : true,
        // message text: dark gray → silver-white gradient
        hasFontGradient        : true,
        fontColor              : '#AAAAAA',
        fontColorGradientStart : '#555555',
        fontColorGradientEnd   : '#E0E0E0',
        hasFontGlow            : true,
        // glitch effect
        hasGlitch              : true,
        // neon silver shadow
        hasNeonShadow          : true,
        neonShadowColor        : '#BBBBBB',
      });
    }
  } else if (msg.type === 'login_failed' || msg.type === 'login_error') {
    console.error('[apply-style] Login failed:', msg.reason || msg.message);
    ws.close();
  } else if (msg.type === 'chat_message' && msg.system) {
    console.log('[apply-style] SYS:', msg.message);
    if (msg.message?.includes('Profile')) setTimeout(() => ws.close(), 1000);
  } else if (msg.type === 'user_style_update' && msg.username === username) {
    console.log('[apply-style] style confirmed:', JSON.stringify(msg.style || {}, null, 2));
  }
});

ws.on('close', (code) => { console.log('[apply-style] done (code=' + code + ')'); process.exit(0); });
ws.on('error', (err)  => { console.error('[apply-style] error:', err.message); process.exit(1); });
setTimeout(() => { console.log('[apply-style] timeout'); ws.close(); }, 30000);
