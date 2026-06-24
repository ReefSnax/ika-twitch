# IkaEXE Twitch Bot

A modular Twitch chat bot for the **ReefSnax** channel. Built with Node.js, tmi.js (IRC), and Claude (Anthropic) for AI-generated event responses, chat interactions, and personalized shoutouts.

---

## Features

### Event Responses (AI-generated)
| Event | Trigger | Behavior |
|-------|---------|----------|
| **Follow** | EventSub webhook relay | Personalized welcome — avoids generic "thanks for the follow" |
| **Sub / Resub** | IRC subscription events | Acknowledges tier, streak, and sub message if present |
| **Sub Gift / Mystery Gift** | IRC events | Thanks the gifter, mentions recipient if known |
| **Bits / Cheers** | IRC cheer events | Recognizes the contribution naturally |
| **Raids** | IRC raid event | Welcomes the raiding community, addresses raid leader by name |
| **Chat Mentions** | Word-boundary regex (`ika`, `ikaexe`, `ikazuchi`) | Responds in-character using recent chat context |

### !shoutout Command
`!shoutout <username>` — generates a unique, friendly one-sentence recommendation:

- Looks up the user's Twitch profile (bio, stream title, game/category)
- Detects pronouns from channel tags (she/her, he/him, they/them, etc.) — defaults to they/them if none found
- Generates a personalized shoutout via Claude
- **Safeguards:** Never mentions politics, ethnicity, race, gender identity, or anything sensitive — sticks to content and vibe
- Falls back cleanly if the user doesn't exist

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
│   ├── ai.js               # Claude API calls — event responses, chat, shoutouts
│   ├── twitchApi.js        # Twitch Helix API — user lookup, stream info, pronoun detection
│   ├── persona.js          # IkaEXE system prompts for Claude
│   ├── streamStatus.js     # Periodic live-status polling via Helix API
│   ├── chatBuffer.js       # Rolling message buffer for chat context
│   └── eventSubRelay.js    # EventSub webhook server (follow events)
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
Three exported functions:
- `generateEventResponse(type, context)` — event-specific prompts
- `generateChatResponse(messages)` — responds to direct mentions with chat history
- `generateShoutout(data)` — generates personalized shoutout from user profile data

All use Claude Sonnet 4.6 (`claude-sonnet-4-6`).

#### `src/twitchApi.js`
Helix API wrappers:
- `getUserInfo(login)` — profile data
- `getStreamInfo(userId)` — live stream details
- `getChannelInfo(userId)` — channel tags (pronouns)
- `extractPronouns(tags)` — regex-based pronoun detection from channel tags
- `lookupShoutoutData(login)` — composite lookup for the shoutout command

#### `src/persona.js`
System prompts that define IkaEXE's character: a squid-type Net Navi assigned to operator ReefSnax. Warm, confident, concise. Uses light Battle Network terminology.

---

## Usage

### Chat Commands

| Command | Example | Description |
|---------|---------|-------------|
| `!shoutout <user>` | `!shoutout djparticle` | Generates a personalized shoutout |
| @mention Ika | `@ika hello!` | Ika responds in character |

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
