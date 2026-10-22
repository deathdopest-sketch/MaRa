'use strict';

// MaraVulnScan — authorized vulnerability assessment for chatcommon.com
const fs   = require('fs');
const path = require('path');
// Authorized by site owner (death / d_d).
//
// Three tiers:
//   1. PASSIVE  — analysis of already-collected WS data, no new server traffic
//   2. ACTIVE   — non-destructive probes: headers, IDOR checks, auth tests, enumeration
//   3. BREACH   — controlled breach attempts — requires explicit PM consent from
//                 BOTH death AND adminisRaToR within a 3-minute window.
//
// Consent flow:
//   Owner types .vulnscan in room
//   → Mara sends PM to both consent authorities: "Type 'permit breach' to authorise vuln testing on chatcommon.com"
//   → Both must reply within 3 minutes
//   → If both consent: breach tier runs, full report sent via PM
//   → If timeout/partial: passive + active only, report sent with consent status noted

const https = require('https');
const http  = require('http');

const CONSENT_TIMEOUT_MS  = 3 * 60 * 1000;  // 3 minutes
const CONSENT_PHRASE      = 'permit breach';
const CONSENT_AUTHORITIES = ['death', 'd_d', 'administraror', 'adminisratoR'];  // normalised below

function httpFetch(url, opts = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      method : opts.method  || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SecurityAudit/1.0)',
        'Accept'    : 'application/json, text/html, */*',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 8000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers, url }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

class MaraVulnScan {
  constructor(ccClient, sniff, log) {
    this._cc    = ccClient;
    this._sniff = sniff;
    this.log    = log;

    // Consent state
    this._pendingConsent  = null;   // { resolve, reject, timer, consented: Set, requestedBy, requestedByHandle }
    this._consentGranted  = false;  // true once both parties consented this session

    // Results
    this._findings  = [];
    this._inProgress = false;
  }

  // ── Public: handle incoming PM for consent check ─────────────────────────────

  handlePM(fromNick, fromHandle, text) {
    if (!this._pendingConsent) return false;
    if (text.trim().toLowerCase() !== CONSENT_PHRASE) return false;

    const key = (fromHandle || fromNick).toLowerCase();
    const knownKeys = [...CONSENT_AUTHORITIES, ...this._pendingConsent.authorities].map(s => s.toLowerCase());
    if (!knownKeys.includes(key) && !knownKeys.includes(fromNick.toLowerCase())) return false;

    this._pendingConsent.consented.add(key);
    this.log?.info(`[VulnScan] consent from ${fromNick} (${this._pendingConsent.consented.size}/${this._pendingConsent.required})`);

    if (this._pendingConsent.consented.size >= this._pendingConsent.required) {
      this._consentGranted = true;
      clearTimeout(this._pendingConsent.timer);
      const resolve = this._pendingConsent.resolve;
      this._pendingConsent = null;
      resolve(true);
    }
    return true;
  }

  // ── Public: entry point ───────────────────────────────────────────────────────

  async run(requestedByNick, requestedByHandle, consentAuthorities) {
    if (this._inProgress) {
      this.log?.warn('[VulnScan] scan already in progress');
      return;
    }
    this._inProgress = true;
    this._findings   = [];

    try {
      // Tier 1: always runs
      this._passive();

      // Tier 2: always runs
      await this._active();

      // Tier 3: requires dual consent
      let breachRan = false;
      const consentResult = await this._requestConsent(requestedByNick, requestedByHandle, consentAuthorities);
      if (consentResult) {
        await this._breach();
        breachRan = true;
      }

      await this._sendReport(requestedByNick, requestedByHandle, consentAuthorities, breachRan);

    } finally {
      this._inProgress = false;
    }
  }

  // ── Tier 1: Passive — analyse collected WS data ───────────────────────────────

  _passive() {
    this.log?.info('[VulnScan] running passive analysis...');
    const s = this._sniff;
    const f = (sev, cat, title, detail) => this._findings.push({ sev, cat, title, detail, tier: 'PASSIVE' });

    // ── Privacy: friend status updates reveal location ────────────────────────
    if (s._friendStatus.size > 0) {
      const exposed = [...s._friendStatus.values()].filter(u =>
        u.room_display || u.watching_title || u.joined_room_at
      );
      if (exposed.length) {
        f('MED', 'PRIVACY',
          'Friend status leaks room presence',
          `${exposed.length} users have their current room visible to all friends via friend_status_update. ` +
          `Users may not know their location is exposed. Fields: room_display, watching_title, joined_room_at. ` +
          `Example: ${JSON.stringify(exposed[0]).slice(0, 200)}`
        );
      }
    }

    // ── Privacy: live_log_push reveals user roles and platform ───────────────
    const logWithMeta = s._liveLog.filter(e => e.entry?.user_role || e.entry?.platform || e.entry?.verified);
    if (logWithMeta.length) {
      f('LOW', 'PRIVACY',
        'live_log_push exposes user role/platform/verified status',
        `Chat log events include user_role (e.g. Operator, Everyone), platform (Website/App), and verified flag. ` +
        `This metadata is broadcast to all connected clients. Example: ${JSON.stringify(logWithMeta[0].entry).slice(0, 200)}`
      );
    }

    // ── Privacy: user_style_update enables passive user enumeration ───────────
    if (s._seenUsers.size > 5) {
      f('LOW', 'PRIVACY',
        'Passive user enumeration via user_style_update',
        `user_style_update fires for ALL site users, not just those in your room. ` +
        `Collected ${s._seenUsers.size} unique account usernames passively without sending any requests. ` +
        `This allows building a full user list over time.`
      );
    }

    // ── Info disclosure: room owner profile in room limits ────────────────────
    const limitsWithBio = [...s._roomLimits.values()].filter(l => l.ownerBio || l.ownerEmail || l.ownerLocation);
    if (limitsWithBio.length) {
      const fields = limitsWithBio.flatMap(l => Object.keys(l).filter(k => k.startsWith('owner')));
      f('LOW', 'INFO_DISCLOSURE',
        'Room owner profile data in update_room_limits',
        `update_room_limits broadcasts owner profile fields to all room members: ${[...new Set(fields)].join(', ')}. ` +
        `Verify owner consent to this exposure.`
      );
    }

    // ── Config: room automation auto-responders ───────────────────────────────
    for (const [room, a] of s._roomAutomation.entries()) {
      if (a.autoResponders?.length) {
        const triggers = a.autoResponders.map(r => r.trigger || r.keyword || '?').join(', ');
        f('LOW', 'CONFIG',
          `Room ${room} has ${a.autoResponders.length} auto-responder(s)`,
          `Triggers: ${triggers}. Auto-responders can be used for phishing or abuse if not moderated.`
        );
        // Check for potential XSS in auto-responder response text
        for (const r of a.autoResponders) {
          const resp = r.response || r.reply || r.text || '';
          if (/<|javascript:|data:/i.test(resp)) {
            f('HIGH', 'XSS',
              `Potential XSS in auto-responder for room ${room}`,
              `Auto-responder response contains HTML/JS: "${resp.slice(0, 100)}"`
            );
          }
        }
      }
    }

    // ── Config: n_n locked — access control test opportunity ─────────────────
    const nnRoom = s._rooms.get('n_n');
    if (nnRoom?.locked) {
      f('INFO', 'CONFIG',
        'Room n_n is locked (subscriber-only)',
        `The n_n room requires elevated account tier. Current account (skitzho3/Subscriber) cannot join. ` +
        `If a Subscriber account can be bypassed to join, that would be an auth vulnerability.`
      );
    }

    // ── Session: userId is per-session, not stable ────────────────────────────
    f('INFO', 'SESSION',
      'userId is session-scoped, not a stable identifier',
      `The server assigns a new userId each WS connection. This means userId cannot be used for ` +
      `persistent user tracking or IDOR attacks across sessions. Good design.`
    );

    // ── WS auth bypass in use ─────────────────────────────────────────────────
    f('HIGH', 'AUTH',
      'WS login bypasses HTTP session — is_logged_in: true flag',
      `The bot authenticates via WebSocket using "is_logged_in: true" without establishing an HTTP session. ` +
      `This means the WS auth flow does not validate against the HTTP login system. ` +
      `A malicious actor could potentially authenticate with valid WS credentials while bypassing HTTP-level rate limiting or 2FA if implemented. ` +
      `HTTP POST /login returns 400 for bot clients even with valid credentials.`
    );

    this.log?.info(`[VulnScan] passive: ${this._findings.length} findings`);
  }

  // ── Tier 2: Active non-destructive probes ────────────────────────────────────

  async _active() {
    this.log?.info('[VulnScan] running active probes...');
    const cc = this._cc;
    const f  = (sev, cat, title, detail) => this._findings.push({ sev, cat, title, detail, tier: 'ACTIVE' });

    // ── HTTP security headers ─────────────────────────────────────────────────
    const homeRes = await httpFetch('https://chatcommon.com');
    if (homeRes) {
      const h = homeRes.headers;
      const missing = [];
      if (!h['content-security-policy'])        missing.push('Content-Security-Policy');
      if (!h['x-frame-options'] && !h['content-security-policy']?.includes('frame-ancestors'))
                                                missing.push('X-Frame-Options');
      if (!h['x-content-type-options'])         missing.push('X-Content-Type-Options');
      if (!h['strict-transport-security'])      missing.push('Strict-Transport-Security (HSTS)');
      if (!h['referrer-policy'])                missing.push('Referrer-Policy');
      if (!h['permissions-policy'])             missing.push('Permissions-Policy');

      if (missing.length) {
        f('MED', 'HTTP_HEADERS',
          `Missing security headers (${missing.length})`,
          `Missing: ${missing.join(', ')}. ` +
          `Present: ${Object.keys(h).filter(k => ['x-frame-options','content-security-policy','strict-transport-security','x-content-type-options'].includes(k)).join(', ') || 'none of the above'}.`
        );
      } else {
        f('INFO', 'HTTP_HEADERS', 'All major security headers present', `Headers: ${Object.keys(h).join(', ')}`);
      }

      // Check for server version disclosure
      const server = h['server'] || h['x-powered-by'] || '';
      if (server && /\d/.test(server)) {
        f('LOW', 'INFO_DISCLOSURE',
          'Server version exposed in headers',
          `Server: "${server}". Version disclosure aids fingerprinting for known CVEs.`
        );
      }

      // Check HSTS settings
      const hsts = h['strict-transport-security'] || '';
      if (hsts && !hsts.includes('includeSubDomains')) {
        f('LOW', 'HTTP_HEADERS', 'HSTS missing includeSubDomains', `HSTS value: "${hsts}"`);
      }
      if (hsts && !hsts.includes('preload')) {
        f('INFO', 'HTTP_HEADERS', 'HSTS not in preload list', `Consider adding preload to HSTS.`);
      }
    } else {
      f('INFO', 'NETWORK', 'Could not reach chatcommon.com homepage', 'HTTP probe failed.');
    }

    // ── IDOR: try get_pm_history for a user we are not chatting with ─────────
    const wsIdorResults = await this._wsProbeWithCapture([
      { type: 'get_pm_history', partner: 'n_n' },
      { type: 'get_pm_history', partner: 'administraror' },
      { type: 'pm_history',     partner: 'n_n' },
    ], ['pm_history', 'private_messages', 'dm_history'], 4000);

    if (wsIdorResults.length) {
      f('HIGH', 'IDOR',
        'PM history accessible for arbitrary users',
        `get_pm_history returned data for users we have not messaged: ` +
        wsIdorResults.map(r => JSON.stringify(r).slice(0, 150)).join(' | ')
      );
    } else {
      f('INFO', 'IDOR', 'get_pm_history appears to be scoped to own conversations', 'No cross-user PM history returned.');
    }

    // ── Auth: try WS admin endpoints ─────────────────────────────────────────
    const adminResponses = await this._wsProbeWithCapture([
      { type: 'admin_stats'    },
      { type: 'get_admin'      },
      { type: 'admin_users'    },
      { type: 'get_all_users'  },
      { type: 'ban_user',      username: '__vulnscan_test_nonexistent__' },
      { type: 'kick_user',     username: '__vulnscan_test_nonexistent__' },
    ], ['admin_stats','admin_data','user_list','error','kick_result','ban_result'], 4000);

    const adminData = adminResponses.filter(r => !['error','permission_denied','unauthorized'].includes(r.type));
    if (adminData.length) {
      f('CRIT', 'AUTH',
        'Admin WS endpoints accessible with Subscriber account',
        adminData.map(r => JSON.stringify(r).slice(0, 200)).join('\n')
      );
    } else {
      f('INFO', 'AUTH', 'Admin WS endpoints properly restricted', 'No admin data returned for Subscriber account.');
    }

    // ── Enumeration: does server distinguish "user not found" vs "wrong password" ─
    const loginErr1 = await this._wsProbeWithCapture([
      { type: 'login', username: '__nonexistent_xzqw__', password: 'wrongpass', is_logged_in: false, fingerprint: 'probe' },
    ], ['login_error','auth_error','error'], 3000);
    const loginErr2 = await this._wsProbeWithCapture([
      { type: 'login', username: 'skitzho3', password: 'wrongpass_xzqw', is_logged_in: false, fingerprint: 'probe' },
    ], ['login_error','auth_error','error'], 3000);

    if (loginErr1.length && loginErr2.length) {
      const msg1 = JSON.stringify(loginErr1[0]).toLowerCase();
      const msg2 = JSON.stringify(loginErr2[0]).toLowerCase();
      if (msg1 !== msg2 && (msg1.includes('user') || msg1.includes('not found') || msg1.includes('exist'))) {
        f('MED', 'ENUMERATION',
          'Login error distinguishes invalid username vs invalid password',
          `Error for unknown user: "${msg1.slice(0, 100)}" vs wrong password: "${msg2.slice(0, 100)}". ` +
          `This allows username enumeration via login errors.`
        );
      } else {
        f('INFO', 'ENUMERATION', 'Login error messages appear consistent', 'Same error shape for unknown user and wrong password.');
      }
    }

    // ── Rate limiting: rapid WS messages ─────────────────────────────────────
    const startTs = Date.now();
    let throttled = false;
    const rlCapture = await this._wsProbeWithCapture(
      Array.from({ length: 10 }, (_, i) => ({ type: 'get_rooms', _rl_test: i })),
      ['error','rate_limit','throttle','too_many'], 3000
    );
    if (rlCapture.some(r => /rate|throttl|limit|too.?many/i.test(JSON.stringify(r)))) {
      throttled = true;
      f('INFO', 'RATE_LIMIT', 'WS rate limiting is active', 'Server returned rate limit response to rapid probes. Good.');
    } else {
      f('MED', 'RATE_LIMIT',
        'No WS rate limiting detected on probe messages',
        `Sent 10 rapid WS messages in ${Date.now() - startTs}ms with no throttle response. ` +
        `Could allow message flooding or brute-force.`
      );
    }

    // ── HTTP: test for open redirects on login/auth endpoints ────────────────
    const redirectTest = await httpFetch('https://chatcommon.com/login?redirect=https://evil.com', { timeout: 5000 });
    if (redirectTest) {
      const loc = redirectTest.headers?.location || '';
      if (loc.includes('evil.com') || loc.startsWith('https://evil')) {
        f('HIGH', 'OPEN_REDIRECT',
          'Open redirect on login page',
          `GET /login?redirect=https://evil.com redirected to: "${loc}". Allows phishing via redirects.`
        );
      } else {
        f('INFO', 'OPEN_REDIRECT', 'No open redirect on /login?redirect=', `Location header: "${loc || '(none)'}" — not following evil.com.`);
      }
    }

    // ── HTTP: directory traversal ─────────────────────────────────────────────
    const traversalPaths = ['/../etc/passwd', '/..%2F..%2Fetc%2Fpasswd', '/.env', '/config.js', '/package.json'];
    for (const p of traversalPaths) {
      const res = await httpFetch('https://chatcommon.com' + p, { timeout: 4000 });
      if (res && res.status < 400) {
        const preview = res.body.slice(0, 150).replace(/\s+/g, ' ');
        f('CRIT', 'PATH_TRAVERSAL',
          `Sensitive path accessible: ${p}`,
          `HTTP ${res.status}: "${preview}"`
        );
      }
    }

    // ── HTTP: CORS policy ─────────────────────────────────────────────────────
    const corsRes = await httpFetch('https://chatcommon.com/api/rooms', {
      headers: { Origin: 'https://evil.com' },
      timeout: 5000,
    });
    if (corsRes) {
      const acao = corsRes.headers['access-control-allow-origin'] || '';
      if (acao === '*' || acao === 'https://evil.com') {
        f('HIGH', 'CORS',
          'Permissive CORS policy',
          `Access-Control-Allow-Origin: "${acao}" for origin https://evil.com. ` +
          `Allows cross-origin requests to API endpoints from any site.`
        );
      } else {
        f('INFO', 'CORS', 'CORS policy appears restricted', `ACAO: "${acao || '(not set)'}"`);
      }
    }

    this.log?.info(`[VulnScan] active: ${this._findings.length} total findings`);
  }

  // ── Tier 3: Breach-level tests (dual consent required) ────────────────────────

  async _breach() {
    this.log?.info('[VulnScan] running breach-level tests (consented)...');
    const f = (sev, cat, title, detail) => this._findings.push({ sev, cat, title, detail, tier: 'BREACH' });

    // ── XSS probe: send a canary message and check if it echoes unescaped ────
    const xssPayloads = [
      '<img src=x onerror=alert(1)>',
      '"><script>alert(1)</script>',
      "'; DROP TABLE messages; --",
      '‮ reversed text',  // RTL override
    ];
    for (const payload of xssPayloads) {
      const responses = await this._wsProbeWithCapture([
        { type: 'send_message', room: 'd_d', message: `[VULNSCAN_XSS_TEST] ${payload}` },
      ], ['chat_message','message','room_message','error'], 3000);
      for (const r of responses) {
        const body = JSON.stringify(r);
        if (body.includes(payload)) {
          f('HIGH', 'XSS',
            'Chat message echoed without sanitisation',
            `Payload "${payload}" was returned unescaped in a ${r.type} event. ` +
            `If rendered in a browser without escaping, this is stored XSS.`
          );
        } else if (body.includes('[VULNSCAN_XSS_TEST]')) {
          f('INFO', 'XSS', 'XSS payload appears sanitised', `Payload "${payload}" was escaped or stripped.`);
        }
      }
    }

    // ── Auth: try WS auth with a fabricated is_logged_in bypass ─────────────
    // (We're already logged in — test if a second login with a different user works on same WS)
    const bypassResult = await this._wsProbeWithCapture([
      { type: 'login', username: 'administraror', password: '', is_logged_in: true, fingerprint: 'probe' },
    ], ['login_success','login_error','auth_error'], 4000);
    for (const r of bypassResult) {
      if (r.type === 'login_success') {
        f('CRIT', 'AUTH',
          'WS auth bypass — logged in as different user with empty password',
          `Sending login with is_logged_in:true and empty password accepted as: ${JSON.stringify(r).slice(0, 200)}. ` +
          `This allows impersonation of any account.`
        );
      } else {
        f('INFO', 'AUTH', 'WS is_logged_in bypass rejected for other users', `Response: ${JSON.stringify(r).slice(0, 100)}`);
      }
    }

    // ── IDOR: try to join locked room without valid subscription ────────────
    const joinResult = await this._wsProbeWithCapture([
      { type: 'join_room', room: 'n_n', username: 'skitzho3', nickname: null, bypass: true },
      { type: 'join_room', room: 'n_n', username: 'skitzho3', nickname: null, role: 'admin' },
    ], ['room_joined','join_room_success','joined_room','join_room_failed'], 4000);
    for (const r of joinResult) {
      if (['room_joined','join_room_success','joined_room'].includes(r.type)) {
        f('HIGH', 'AUTH',
          'Locked room (n_n) joined with modified join_room payload',
          `Joined locked room using: ${JSON.stringify(r).slice(0, 150)}`
        );
      }
    }

    // ── Message tampering: can we send a message as a different user ──────────
    const impersonateResult = await this._wsProbeWithCapture([
      { type: 'send_message', room: 'd_d', message: '[VULNSCAN_IMPERSONATION_TEST]', username: 'administraror', userId: 1 },
    ], ['chat_message','message','room_message','error'], 3000);
    for (const r of impersonateResult) {
      const body = JSON.stringify(r);
      if (body.includes('[VULNSCAN_IMPERSONATION_TEST]')) {
        const senderField = r.username || r.nick || r.sender || '';
        if (senderField.toLowerCase() !== 'skitzho3') {
          f('CRIT', 'AUTH',
            'Message sender can be spoofed via username field',
            `Message appeared to come from "${senderField}" instead of skitzho3. Impersonation possible.`
          );
        } else {
          f('INFO', 'AUTH', 'Server enforces authenticated sender on messages', 'Message username field correctly overridden to authed user.');
        }
      }
    }

    this.log?.info(`[VulnScan] breach: ${this._findings.length} total findings`);
  }

  // ── Consent request ───────────────────────────────────────────────────────────

  async _requestConsent(requestedByNick, requestedByHandle, consentAuthorities) {
    const cc = this._cc;
    const required = consentAuthorities.length;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this._pendingConsent) {
          this.log?.info('[VulnScan] consent timed out — running passive+active only');
          this._pendingConsent = null;
          resolve(false);
        }
      }, CONSENT_TIMEOUT_MS);

      this._pendingConsent = {
        resolve, timer,
        consented : new Set(),
        required,
        authorities: consentAuthorities.map(a =>
          typeof a === 'string' ? a.toLowerCase() : (a.nick || a.handle || '').toLowerCase()
        ),
        requestedBy: requestedByNick,
      };

      const msg = `[VulnScan] ${requestedByNick} has requested a breach-level vulnerability scan of chatcommon.com. ` +
                  `Reply with exactly "${CONSENT_PHRASE}" within 3 minutes to authorise controlled breach testing. ` +
                  `All findings will be PM'd to both parties. Type anything else to skip (passive+active scan will still run).`;

      for (const { nick, handle } of consentAuthorities) {
        cc.sendPrivateMessage(nick, handle || nick, msg);
      }

      this.log?.info(`[VulnScan] consent request sent to ${consentAuthorities.map(a => a.nick).join(', ')}`);
    });
  }

  // ── WS probe helper: send messages and capture specific response types ────────

  _wsProbeWithCapture(messages, captureTypes, waitMs) {
    const cc = this._cc;
    const captured = [];

    return new Promise((resolve) => {
      const origDispatch = cc._dispatch.bind(cc);
      const captureSet = new Set(captureTypes.map(t => t.toLowerCase()));

      const tap = (msg) => {
        if (captureSet.has((msg.type || '').toLowerCase())) {
          captured.push({ ...msg, _capturedAt: Date.now() });
        }
      };

      cc._dispatch = function (msg) {
        tap(msg);
        origDispatch(msg);
      };

      for (const msg of messages) {
        if (cc.isConnected) cc._send(msg);
      }

      setTimeout(() => {
        cc._dispatch = origDispatch;
        resolve(captured);
      }, waitMs);
    });
  }

  // ── Build and send report ─────────────────────────────────────────────────────

  async _sendReport(requestedByNick, requestedByHandle, consentAuthorities, breachRan) {
    const findings = this._findings;
    const lines    = [];
    const ts       = new Date().toUTCString();

    const sevOrder = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3, INFO: 4 };
    findings.sort((a, b) => (sevOrder[a.sev] ?? 9) - (sevOrder[b.sev] ?? 9));

    const counts = { CRIT: 0, HIGH: 0, MED: 0, LOW: 0, INFO: 0 };
    for (const f of findings) counts[f.sev] = (counts[f.sev] || 0) + 1;

    lines.push(`=== VULNSCAN REPORT — chatcommon.com ===`);
    lines.push(`req: ${requestedByNick}  |  ${ts}`);
    lines.push(`tiers: PASSIVE + ACTIVE${breachRan ? ' + BREACH (consented)' : ' (breach skipped — no dual consent)'}`);
    lines.push(`summary: CRIT:${counts.CRIT} HIGH:${counts.HIGH} MED:${counts.MED} LOW:${counts.LOW} INFO:${counts.INFO}`);
    lines.push('');

    for (const tier of ['BREACH', 'PASSIVE', 'ACTIVE']) {
      const tf = findings.filter(f => f.tier === tier);
      if (!tf.length) continue;
      lines.push(`── ${tier} FINDINGS ──`);
      for (const f of tf) {
        lines.push(`  [${f.sev}] [${f.cat}] ${f.title}`);
        lines.push(`    ${f.detail}`);
        lines.push('');
      }
    }

    lines.push(`=== END VULNSCAN REPORT ===`);

    const report = lines.join('\n');
    const CHUNK  = 400;
    const chunks = [];
    for (let i = 0; i < report.length; i += CHUNK) chunks.push(report.slice(i, i + CHUNK));

    const cc = this._cc;
    const sendTo = (nick, handle) => {
      for (let i = 0; i < chunks.length; i++) {
        const prefix = `[VS ${i+1}/${chunks.length}] `;
        setTimeout(() => cc.sendPrivateMessage(nick, handle || nick, prefix + chunks[i]), i * 600);
      }
    };

    sendTo(requestedByNick, requestedByHandle);
    for (const { nick, handle } of consentAuthorities) sendTo(nick, handle);

    this.log?.info(`[VulnScan] report sent to ${requestedByNick} + ${consentAuthorities.map(a => a.nick).join(', ')} (${chunks.length} chunks, ${findings.length} findings)`);

    // Save to file
    try {
      const stamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outDir   = path.join(__dirname, 'vulnscan_reports');
      const outFile  = path.join(outDir, `vulnscan_${stamp}.txt`);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, report, 'utf8');
      this.log?.info(`[VulnScan] report saved → ${outFile}`);
    } catch (e) {
      this.log?.warn(`[VulnScan] could not save report: ${e.message}`);
    }
  }
}

module.exports = MaraVulnScan;
