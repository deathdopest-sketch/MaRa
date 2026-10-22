# m̷a̸r̵a̷

> s̷h̷e̸ ̵w̷a̸t̴c̸h̷e̴s̵ ̷t̵h̸e̴ ̷r̵o̷o̸m̴.̷ ̸s̵h̷e̴ ̸k̵n̷o̸w̴s̷.̶ ̸s̵h̷e̸ ̴n̵e̷v̸e̴r̵ ̸s̷p̵e̸a̴k̷s̵.̸

Control routes through **freddysparks**. See `OWNER_ACCOUNT` in `.env`.

---

## What it is

MaRa has two modes:

**Sniffer** (`node mara.js`) — passive intelligence. Connects to chat rooms, never sends a single message, and builds a live picture of room mood, user dynamics, and relationships. Dashboard runs in the terminal. Snapshots save to `data/` every 10 minutes. Works standalone on any PC with just credentials + Node.js.

**Full bot** (`node main.js`) — the original MaRa bot. AI-powered personality, full ChatCommon infiltration mode, roleplay system, memory, etc. Separate thing — see the existing code.

---

## Quick start (sniffer)

```
git clone <repo>
cd MaRa
npm install
cp .env.example .env
# fill in CHATCOMMON_USERNAME + CHATCOMMON_PASSWORD + CHATCOMMON_ROOMS
node mara.js
```

That's it. No Chrome, no Puppeteer, no Ollama needed. Just creds and Node.

For MumbleChat instead:

```
# in .env:
PLATFORM=mumble
MUMBLECHAT_BOT_KEY=mc_...
MUMBLECHAT_ROOMS=ddd
```

Both at once:

```
PLATFORM=both
```

---

## What the dashboard shows

```
╔══════════════════════════════════════════════════════╗
║  ☠  MaRa  |  room: d_d  |  HOT  |  DRAMA  |  9 users  ║
╠══════════════════════════════════════════════════════╣
║ TOP USERS                                            ║
║  killaken      87 msgs   leader    death, music, real ║
║  holygang_kw   52 msgs   reactor   memes, drama, nah  ║
╠══════════════════════════════════════════════════════╣
║ RELATIONSHIPS                                        ║
║  killaken ↔ holygang_kw  [FRIENDLY, 8 exchanges]    ║
║  death ↔ maga            [HOSTILE, 3 exchanges]      ║
╠══════════════════════════════════════════════════════╣
║ LIVE FEED                                            ║
║  14:23  killaken      this is some real shit         ║
╠══════════════════════════════════════════════════════╣
║ mood history: HOT/DRAMA → ACTIVE/CHILL → HOT/DRAMA  ║
╚══════════════════════════════════════════════════════╝
```

**Energy levels:** DEAD → QUIET → ACTIVE → HOT → VOLATILE (based on messages/min in the last 60s)

**Tone:** CHILL / HYPE / DRAMA / SEXUAL / HOSTILE / WEIRD / MIXED (from content signals in the last 2 min)

**User styles:**
- `leader` — high message count, above-average length
- `reactor` — responds quickly to others, follows conversational timing
- `chaos` — short rapid-fire messages, lots of exclamation
- `questioner` — more than 30% of messages are questions
- `ranter` — long messages (150+ chars average)
- `lurker` — fewer than 5 messages this session

**Relationships:** built from @mentions (strong signal) + response proximity (who replies to who within 15s). Tone (friendly/hostile/flirty/intellectual) is inferred from the content of those exchanges.

---

## Env variables

| Variable | Default | What it does |
|---|---|---|
| `OWNER_ACCOUNT` | — | Your username. Unlocks the death greeting. |
| `PLATFORM` | `chatcommon` | Which platform(s) to sniff: `chatcommon` / `mumble` / `both` |
| `CHATCOMMON_USERNAME` | — | ChatCommon account username |
| `CHATCOMMON_PASSWORD` | — | ChatCommon account password |
| `CHATCOMMON_ROOMS` | `d_d` | Comma-separated rooms to join |
| `MUMBLECHAT_BOT_KEY` | — | MumbleChat bot API key |
| `MUMBLECHAT_SERVER_URL` | `https://mumblechat.online` | MumbleChat server |
| `MUMBLECHAT_ROOMS` | `ddd` | Comma-separated rooms |
| `MARA_DATA_DIR` | `./data` | Where snapshots are saved |
| `MARA_REFRESH_MS` | `2000` | Dashboard refresh rate in ms |
| `SOCKS_PROXY` | — | Optional SOCKS5 proxy, e.g. `socks5://127.0.0.1:1080` |
| `DEBUG_MARA` | — | Set to `1` for verbose WS logging |

---

## How relationships are detected

1. **@mentions** — if someone tags `@nick` in a message, that's a direct connection. Strong signal, weighted heavily.
2. **Response proximity** — if B speaks within 15 seconds after A, it's counted as a soft connection. They're paying attention to each other.
3. **Tone signals** — MaRa reads the text of @-mentions to classify tone:
   - `@nick fuck/idiot/stupid` → hostile
   - `@nick lol/haha/same/yeah` → friendly
   - `@nick hot/cute/babe/miss` → flirty
   - `@nick think/point/agree/actually` → intellectual

Relationship strength scales from 0–10. Alliances are detected by connected-component clustering of strong (≥3) non-hostile relationships. Tensions are hostile pairs with strength ≥2.

---

## Data snapshots

Every 10 minutes MaRa saves a JSON snapshot to `data/mara_snapshot_<timestamp>.json`. Also saves on SIGINT/SIGTERM (Ctrl+C).

The snapshot contains:
- `mood` — per-room energy/tone history
- `relationships` — all detected edges
- `profiles` — per-user stats (messages, style, topics, mentions, etc.)

These are reference files — MaRa doesn't load them on startup, she starts fresh each session. If you want to resume from a snapshot you'd need to wire `fromSnapshot()` on each analyzer (it's there if you want it).

---

## Platform notes

**ChatCommon** — connects directly to `wss://ws.chatcommon.com/` with credentials. Standard username/password. No browser needed.

**MumbleChat** — connects via Socket.IO with a bot API key. Get the key from your MumbleChat server admin or from `setup-spackle-bot.js` if you're running a MumbleChat instance.

**Both** — runs both adapters simultaneously, feeds into the same analyzer stack. Rooms show up in the dashboard as they're joined.

---

## Troubleshooting

**Dashboard is blank / "listening..."** — MaRa connected but no messages have come in yet. Give it a minute. Check the room name is right.

**Login error** — check your credentials in `.env`. For ChatCommon, make sure you're using the account username (not email) if the server requires that.

**Connection timeout** — server unreachable, or wrong URL. For MumbleChat, make sure `MUMBLECHAT_SERVER_URL` matches exactly what the server is running on.

**`Cannot find module 'socket.io-client'`** — run `npm install` again. Make sure you're in the MaRa directory.

**Dashboard is too wide/narrow** — resize your terminal. MaRa adapts to `process.stdout.columns` on each refresh.

**Snapshots not saving** — check `MARA_DATA_DIR` is writable. Defaults to `./data` which is auto-created at startup.

---

## Architecture

```
mara.js
├── src/ChatCommonAdapter.js  — wraps lib/ChatCommonClient.js with EventEmitter
├── src/MumbleAdapter.js      — Socket.IO listener for MumbleChat
├── src/RoomMood.js           — energy (msg/min) + tone (content signals)
├── src/RelationshipMap.js    — edges, alliances, tensions
├── src/UserProfile.js        — per-user stats and style classification
└── src/Dashboard.js          — ANSI terminal display, no external deps
```

The analyzer stack (RoomMood, RelationshipMap, UserProfile) is completely stateless between adapter events — you could drop in any other event source and it'd work the same way.
