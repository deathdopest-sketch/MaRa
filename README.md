# MaRa

**Passive room intelligence for StumbleChat, ChatCommon, and MumbleChat.**

She watches everything. Profiles every user. Hears the room, not just the chat. Never sends a single message.

Built by [Death (DeathAIAUS)](https://github.com/deathdopest-sketch).

---

## What she does

MaRa is a silent observer. She sits in a chat room, reads every message and every spoken word, and builds a live dossier on every person in the room — their psychological profile, attachment style, manipulation patterns, social dynamics, and behavioural history. All of it surfaces in a terminal dashboard with no external services required.

**Live dashboard**
- Interactive TUI — arrow keys to select users, tab to switch rooms
- Per-user profile panel: trait scores, tone breakdown, social read, memory, flags, relationships
- Live feed of messages and transcribed audio at the bottom

**User profiling (per message, updating live)**
- Morality, cunning, formidability, and volatility scores via regex + NNN deep analysis
- Message tone breakdown (positive / neutral / negative %)
- Behavioural flags: aggression spikes, manipulation detected, directed hostility at owner, message batching, story inconsistencies, vulnerability signals, existential themes
- Communication style: lurker / questioner / ranter / chaos agent / reactor / leader
- Vocab richness, dominant topics, room dominance %
- Nick change history, join/leave patterns, days seen vs last seen

**Social intelligence layer (expert sociologist)**
- Attachment style detection: anxious, avoidant, disorganised
- Manipulation pattern recognition: gaslighting, love bombing, triangulation, guilt tripping, victimhood, negging
- Trauma tells: hypervigilance, dissociative patterns, self-deprecation
- Status game tracking: dominance bids, submission signals, name/status dropping
- Rendered as a plain-English narrative in the profile panel

**NNN deep analysis (custom neural architecture)**
- 32-dimensional feature extraction per message
- 16-bank adaptive PNN + 8-ring staggered circular NCNN (VITABIOWORKSHOP architecture)
- Outputs: hostility, intimacy, manipulation detection, authority challenge, bot-risk, existential themes, roleplay signal
- Bank weights self-adapt across the session, persist to `data/MaraMemory/nnn_weights.json`

**WebRTC audio transcription**
- Hooks every RTCPeerConnection before the page loads — catches all audio tracks
- Captures raw PCM at 16kHz from each remote speaker's stream
- Peak-normalized 3-second chunks sent to Node for Whisper transcription
- Speaker attribution via subscribe WS event correlation (8-second window)
- Transcripts flow through the same profiling pipeline as text messages, shown in feed with 🎤
- Powered by `@xenova/transformers` (pure JS Whisper — no Python, no server)

**Associative memory (cross-session)**
- Concept graph linking topics across users and sessions
- Episodic store with 7-day decay scoring
- Surfaces notable past moments per user in the profile panel
- Persists to `data/MaraMemory/associative_network.json` — survives restarts

**Snapshot system**
- Full state dump every 10 minutes to `data/mara_snapshot_*.json`
- Includes mood, relationships, profiles, and social intelligence reads

**Unknown frame logging**
- Any new StumbleChat WebSocket frame type is logged to `data/unknown_frames.jsonl` (once per type) for protocol change detection

---

## Setup

**Requirements:** Node 18+, Google Chrome (for StumbleChat)

```bash
git clone git@github.com:deathdopest-sketch/MaRa.git
cd MaRa
npm install

# optional — enables room audio transcription (~75MB model download on first run)
npm install @xenova/transformers

cp .env.example .env
# edit .env with your credentials and rooms
```

**`.env` minimum for StumbleChat:**
```
PLATFORM=stumblechat
OWNER_ACCOUNT=your_username
OWNER_PASS=your_password
STUMBLECHAT_ROOMS=your_room
```

```bash
node mara.js
```

Chrome launches automatically, logs in, joins the room, and the dashboard starts. First run downloads the Whisper model if `@xenova/transformers` is installed — about 75MB, cached in `data/models/` so subsequent starts are instant.

---

## Platforms

| Platform | How it connects |
|---|---|
| `stumblechat` | Puppeteer auto-launches Chrome, logs in, hooks WebSocket + WebRTC audio |
| `chatcommon` | WebSocket client via credentials |
| `mumble` | REST/WS via MumbleChat bot key |
| `both` | chatcommon + mumble simultaneously |

---

## Architecture

```
mara.js
├── src/StumbleChatAdapter.js   — puppeteer browser automation + auto-login
│   ├── src/WsListener.js       — WebSocket intercept via CDP + frame parsing
│   └── src/AudioCapture.js     — WebRTC audio hook + PCM capture (browser-side)
├── src/AudioPipeline.js        — Whisper transcription queue (Node-side)
├── src/RoomMood.js             — room-level energy + tone rolling average
├── src/RelationshipMap.js      — inter-user relationship graph
├── src/UserProfile.js          — per-user profiling + NNN scoring
├── src/SocialIntelligence.js   — attachment / manipulation / trauma / status patterns
├── src/Dashboard.js            — interactive ANSI TUI
├── NNNProcessor.js             — 32D PNN+NCNN text analysis engine
└── MaraAssociativeMemory.js    — cross-session concept + episodic memory
```

---

## Dashboard controls

| Key | Action |
|---|---|
| `↑` / `↓` | Select user |
| `←` / `→` or `Tab` | Switch room |
| `q` or `Ctrl+C` | Quit (saves snapshot first) |

---

## Data

Everything writes to `./data/` (configurable via `MARA_DATA_DIR`):

```
data/
├── chrome-profile/           — persistent Chrome login session
├── models/                   — Whisper model cache (~75MB, first run only)
├── MaraMemory/
│   ├── associative_network.json
│   └── nnn_weights.json
├── mara_snapshot_*.json      — periodic full-state dumps
└── unknown_frames.jsonl      — new StumbleChat frame types (protocol change detection)
```

`data/` and `.env` are both gitignored. Never commit either.

---

## License

MIT — Death (DeathAIAUS)
