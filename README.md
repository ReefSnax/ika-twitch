# IkaEXE Twitch Bot

A modular Twitch chat bot for the **ReefSnax** channel (Snax's stream). Built with Node.js, tmi.js (IRC), and Claude (Anthropic) for AI-generated event responses, chat interactions, and personalized shoutouts.

---

## Features

### Event Responses (AI-generated)
| Event | Trigger | Behavior |
|-------|---------|----------|
| **Follow** | EventSub webhook relay | Warm, personalized welcome — aware of recent chat vibe |
| **Sub / Resub** | IRC subscription events | Acknowledges tier, streak, and sub message if present |
| **Sub Gift / Mystery Gift** | IRC events | Thanks the gifter, mentions recipient if known |
| **Bits / Cheers** | IRC cheer events | Recognizes the contribution naturally |
| **Raids** | IRC raid event | Welcomes the raiding community, addresses raid leader by name |
| **Chat Mentions** | Word-boundary regex (`ika`, `ikaexe`, `ikazuchi`) | Responds in-character using last 20 chat messages for context |

### !shoutout Command
`!shoutout <username>` — generates a unique, friendly one-sentence recommendation:

- Looks up the user's Twitch profile (bio, stream title, game/category)
- Detects pronouns from channel tags (she/her, he/him, they/them, etc.) — defaults to they/them if none found
- Generates a personalized shoutout via Claude
- **Safeguards:** Never mentions politics, ethnicity, race, gender identity, or anything sensitive — sticks to content and vibe
- Falls back cleanly if the user doesn't exist

### !lurk and Lurker Love
`!lurk` — declares that you're lurking. The bot sends a playful acknowledgment. When you speak in chat again, you get a one-time "welcome back from the deep" message.

- Lurk state is per-session (in-memory, resets if the bot restarts)
- Welcome-back only fires once per lurk session

### Showstarter
When the stream goes live, the bot automatically posts a "we're live!" announcement — energetic, welcoming viewers old and new, and referencing whatever game Snax is actually playing.

- Detected via the StreamStatus module (Helix API polling every 60s)
- Only fires on a `false → true` transition
- References the actual title and game being streamed

### Custom Celebrations
Milestone celebrations for follows and subs. When the bot sees enough events to cross a milestone threshold, it fires a community-wide thank-you message.

| Type | Milestones |
|------|------------|
| **Follows** | 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 5000 |
| **Subs** | 10, 25, 50, 100, 150, 200, 250, 500, 1000 |

- Counts are persisted across bot restarts via `milestone-state.json`
- Each milestone only celebrates once
- Skips events when the stream is offline (except follows, which come via EventSub)

### Systemd Service
Runs as a managed systemd service (`ika-twitch.service`) with automatic restart on failure.

---

## Requirements

- **Node.js** v18+ (tested on v22)
- **Anthropic API key** (Claude)
- **Twitch account** for the bot (can be the channel owner's account)
- **Twitch OAuth token** (for IRC chat) — https://twitchapps.com/tmi/
- **Twitch Client ID + Client Secret** — https://dev.twitch.tv/console/apps
- **EventSub secret** (optional, for follow events) — `openssl rand -hex 32`

---

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/ReefSnax/ika-twitch.git
cd ika-twitch
npm install
```

### 2. Configure Environment

Copy the example env and fill in your values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description | Source |
|----------|-------------|--------|
| `TWITCH_BOT_USERNAME` | Bot account username | Your Twitch account |
| `TWITCH_OAUTH_TOKEN` | IRC password (oauth:xxx) | https://twitchapps.com/tmi/ |
| `TWITCH_CHANNEL` | Channel to join (#reefsnax) | The channel name |
| `TWITCH_CLIENT_ID` | Twitch app client ID | https://dev.twitch.tv/console/apps |
| `TWITCH_CLIENT_SECRET` | Twitch app client secret | Same app page |
| `ANTHROPIC_API_KEY` | Claude API key | https://console.anthropic.com/ |

Optional:

| Variable | Description |
|----------|-------------|
| `EVENTSUB_PORT` | Port for EventSub webhook relay (default: 3456) |
| `EVENTSUB_SECRET` | HMAC secret for EventSub verification |
| `DEBUG` | Set to `true` for verbose tmi.js logs |

### 3. Run

```bash
# Direct
node src/index.js

# With file watching for development
npm run dev
```

### 4. Systemd Service (Production)

The repo includes a systemd service file at `scripts/ika-twitch.service`. To install:

```bash
sudo cp scripts/ika-twitch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ika-twitch
sudo systemctl start ika-twitch
# Check status
sudo systemctl status ika-twitch
```

**Important:** The service file contains hardcoded paths. On a fresh server, verify these match your setup:
- `User=snaxine` → your username
- `WorkingDirectory=/path/to/ika-twitch` → actual repo path
- `ExecStart=/path/to/node src/index.js` → your node binary location

---

## Project Structure

```
ika-twitch/
├── src/
│   ├── index.js            # Entry point — wires up bot + EventSub relay
│   ├── bot.js              # TwitchBot class — IRC client, event handlers, command routing
│   ├── ai.js               # Claude API calls — event responses, chat, shoutouts, lurk, showstarter, celebrations
│   ├── twitchApi.js        # Twitch Helix API — user lookup, stream info, pronoun detection
│   ├── persona.js          # IkaEXE system prompts for Claude
│   ├── streamStatus.js     # Periodic live-status polling via Helix API + change callbacks
│   ├── chatBuffer.js       # Rolling message buffer for chat context
│   ├── eventSubRelay.js    # EventSub webhook server (follow events)
│   ├── lurkTracker.js      # In-memory lurk state tracking
│   └── milestones.js       # Persistent milestone counter (follows, subs)
├── milestone-state.json    # Auto-generated milestone state
├── scripts/
│   └── ika-twitch.service  # systemd unit file
├── .env.example            # Environment variable template
├── package.json
└── README.md
```

### Module Overview

#### `src/index.js`
Creates the `TwitchBot` instance, starts the EventSub relay, and connects to IRC.

#### `src/bot.js`
Core bot logic. Listens for:
- **Chat messages** — checks for `!shoutout` command, then checks if Ika is mentioned
- **Sub/resub/subgift/mysterygift** — sends to AI for responses
- **Cheer/bits** — same as above
- **Raids** — welcomes raiders
- **Follows** — relayed from EventSub server

#### `src/ai.js`
Seven exported functions:
- `generateEventResponse(type, context)` — event-specific prompts, receives optional chat vibe context
- `generateChatResponse(messages)` — responds to direct mentions with last 20 chat messages
- `generateShoutout(data)` — generates personalized shoutout from user profile data
- `generateLurkResponse(username, chatContext)` — acknowledges a lurker
- `generateReturnResponse(username, chatContext)` — one-time "welcome back" for returning lurkers
- `generateShowstarter(stream)` — "we're live!" announcement referencing the actual stream title/game
- `generateCelebration(type, milestone, chatContext)` — milestone thank-yous

All use Claude Sonnet 4 (`claude-sonnet-4-6`).

#### `src/twitchApi.js`
Helix API wrappers:
- `getUserInfo(login)` — profile data
- `getStreamInfo(userId)` — live stream details
- `getChannelInfo(userId)` — channel tags (pronouns)
- `extractPronouns(tags)` — regex-based pronoun detection from channel tags
- `lookupShoutoutData(login)` — composite lookup for the shoutout command

#### `src/persona.js`
System prompts that define IkaEXE's character: a squid-type Net Navi assigned to Snax. Warm, confident, concise. Uses light Battle Network terminology. Channel context is variety gaming — no hardcoded genre assumptions.

#### `src/lurkTracker.js`
In-memory set-based tracker for the `!lurk` command. Tracks which users are currently lurking (lowercased). Offers `startLurk()` to register, and `checkReturn()` to atomically test-and-remove (returns true if they were lurking, meaning they should get a welcome-back message).

#### `src/milestones.js`
Persistent milestone tracker for follows and subs. Stores counts in `milestone-state.json`. `recordFollow()` / `recordSub()` increment the counter and return the milestone number if a threshold was just crossed, or null otherwise. Each milestone only fires once.

---

## Usage

### Chat Commands

| Command | Example | Description |
|---------|---------|-------------|
| `!shoutout <user>` | `!shoutout djparticle` | Generates a personalized shoutout |
| `!lurk` | `!lurk` | Declare lurking — get a welcome-back when you chat again |
| @mention Ika | `@ika hello!` | Ika responds in character |

### Showstarter
The showstarter fires automatically when the stream goes live — no command needed. The bot detects the `offline → live` transition via the Helix API polling.

### EventSub Setup (Follow Events)

tmi.js cannot receive follow events natively. The bot includes an HTTP server for Twitch EventSub webhooks.

1. Ensure the bot is running with `EVENTSUB_SECRET` set
2. Subscribe via the Twitch CLI or API:

```bash
# Using Twitch CLI
twitch event subscribe \
  --transport webhook \
  --secret "$EVENTSUB_SECRET" \
  --callback-url "https://your-public-url/eventsub" \
  --subscription '{"type":"channel.follow","version":"2","condition":{"broadcaster_user_id":"<CHANNEL_USER_ID>"}}'
```

The EventSub relay listens on port `3456` by default (configurable via `EVENTSUB_PORT`).

---

## Architecture

```
┌──────────────┐     IRC      ┌──────────────┐
│   Twitch     │◄────────────►│   Bot (tmi)  │
│   Chat/IRC   │              │              │
└──────────────┘              │  ┌─────────┐ │
                              │  │  Claude │ │
┌──────────────┐  Webhook    │  │  (Anthrop│ │
│  Twitch      │────────────►│  └─────────┘ │
│  EventSub    │             └──────┬───────┘
└──────────────┘                    │
                                    ▼
                            ┌──────────────┐
                            │  Twitch Helix│
                            │  API         │
                            │ (user/stream │
                            │  lookups)    │
                            └──────────────┘
```

- **tmi.js** handles IRC chat (send/receive messages, events)
- **Claude API** generates natural-language responses for events and chat
- **Twitch Helix API** is used for user profile lookups (shoutouts) and live-status polling
- **EventSub** provides follow events via webhook (relayed to the bot by the built-in HTTP server)

---

## Adding Features

### Adding a New Command

In `src/bot.js`, in the `message` handler:

```javascript
// Add this check after the shoutout check
const raidMatch = message.match(/^!raid\s+(\w+)/i);
if (raidMatch) {
  // handle it
  return;
}
```

Then add the handler method and any AI prompts in `src/ai.js`.

### Modifying the Shoutout Prompt

In `src/ai.js`, edit the `generateShoutout` function. The prompt is constructed programmatically — adjust the constraints (max length, sensitivity filters) as needed.

---

## Troubleshooting

### Bot won't connect to IRC
- Verify `TWITCH_OAUTH_TOKEN` starts with `oauth:` and is valid (regenerate at https://twitchapps.com/tmi/)
- Check the bot isn't already connected elsewhere (Twitch kicks duplicate connections)

### Shoutout fails with "User not found"
- Twitch usernames are case-insensitive but the bot handles that
- Some accounts may be deleted or renamed

### Claude API errors
- Check `ANTHROPIC_API_KEY` is set and valid
- Verify you have credits/access in your Anthropic console
- The bot uses `claude-sonnet-4-6` — update the model name in `src/ai.js` if needed

### Follow events not working
- The EventSub relay requires a publicly accessible URL (for webhook delivery)
- Verify `EVENTSUB_SECRET` is set and matches the subscription
- Check the bot's HTTP server is reachable from Twitch

---

## License

MIT
