import tmi from 'tmi.js';
import { generateEventResponse, generateChatResponse, generateShoutout } from './ai.js';
import { lookupShoutoutData } from './twitchApi.js';
import { StreamStatus } from './streamStatus.js';
import { ChatBuffer } from './chatBuffer.js';

// Names Ika should respond to in chat
// Uses word boundaries so "Pikachu" doesn't trigger but "@ika" / "ika?" / "ikaexe" do.
const IKA_TRIGGER_REGEX = /\b(?:ika|ikaexe|ikazuchi)\b/i;

export class TwitchBot {
  constructor() {
    this.channel = process.env.TWITCH_CHANNEL;
    this.streamStatus = new StreamStatus();
    this.chatBuffer = new ChatBuffer(20);

    this.client = new tmi.Client({
      options: { debug: process.env.DEBUG === 'true' },
      identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: process.env.TWITCH_OAUTH_TOKEN, // oauth:xxxx format
      },
      channels: [this.channel],
    });

    this._bindEvents();
  }

  _bindEvents() {
    this.client.on('connected', () => {
      console.log(`[IkaEXE] Connected to #${this.channel}`);
    });

    this.client.on('disconnected', (reason) => {
      console.warn(`[IkaEXE] Disconnected: ${reason}`);
    });

    // --- Chat messages ---
    this.client.on('message', (channel, tags, message, self) => {
      if (self) return; // ignore own messages

      const username = tags['display-name'] || tags.username;
      this.chatBuffer.add(username, message);

      // Check for !shoutout command
      const shoutoutMatch = message.match(/^!shoutout\s+(\w+)/i);
      if (shoutoutMatch) {
        const target = shoutoutMatch[1];
        this._handleShoutout(channel, username, target);
        return;
      }

      // Check if Ika is being addressed (word-boundary match, so "Pikachu" won't trigger)
      const mentioned = IKA_TRIGGER_REGEX.test(message);
      if (mentioned) {
        this._handleChatMention(channel, username, message);
      }
    });

    // --- Follows ---
    // tmi.js doesn't receive follows natively; this fires if you set up
    // EventSub to relay to the bot via a custom event (see README).
    // For now, handled via the public API relay in eventRelay.js.

    // --- Subscriptions ---
    this.client.on('subscription', (channel, username, method, message, userstate) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('sub', {
        username: userstate['display-name'] || username,
        months: 1,
        tier: this._parseTier(method?.plan),
        message,
      });
    });

    this.client.on('resub', (channel, username, months, message, userstate, methods) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('resub', {
        username: userstate['display-name'] || username,
        months,
        streak: userstate['streak-months'] || null,
        tier: this._parseTier(methods?.plan),
        message,
      });
    });

    this.client.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('subgift', {
        username: userstate['display-name'] || username,
        recipient,
        count: 1,
      });
    });

    this.client.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('subgift', {
        username: userstate['display-name'] || username,
        recipient: null,
        count: numbOfSubs,
      });
    });

    // --- Bits ---
    this.client.on('cheer', (channel, userstate, message) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('bits', {
        username: userstate['display-name'] || userstate.username,
        amount: userstate.bits,
        message: message.replace(/\bcheer\d+\b/gi, '').trim() || null,
      });
    });

    // --- Raids ---
    this.client.on('raided', (channel, username, viewers) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('raid', { username, viewers });
    });
  }

  async _handleEvent(type, context) {
    try {
      console.log(`[IkaEXE] Handling event: ${type}`, context);
      const response = await generateEventResponse(type, context);
      await this._say(response);
    } catch (err) {
      console.error(`[IkaEXE] Error handling ${type} event:`, err.message);
    }
  }

  async _handleChatMention(channel, username, message) {
    try {
      const context = this.chatBuffer.getContext(10);
      const messages = [
        ...context,
        {
          role: 'user',
          content: `${username} just addressed you directly in chat: "${message}"\n\nRespond as IkaEXE. Keep it under 400 characters.`,
        },
      ];
      const response = await generateChatResponse(messages);
      // Trim to Twitch's 500 char limit just in case
      const trimmed = response.slice(0, 490);
      await this._say(trimmed);
    } catch (err) {
      console.error('[IkaEXE] Error handling chat mention:', err.message);
    }
  }

  async _handleShoutout(channel, requester, target) {
    try {
      console.log(`[IkaEXE] Shoutout requested by ${requester} for ${target}`);

      const data = await lookupShoutoutData(target);
      const shoutout = await generateShoutout(data);

      const message = `Check out ${target} over at https://twitch.tv/${target} — ${shoutout}`;
      const trimmed = message.slice(0, 490);
      await this._say(trimmed);
    } catch (err) {
      console.error(`[IkaEXE] Shoutout failed for ${target}:`, err.message);
      if (err.message.includes('not found')) {
        await this._say(`@${requester}, I couldn't find a Twitch user named "${target}". Double-check the spelling?`);
      } else {
        await this._say(`@${requester}, sorry — shoutout glitched. Try again in a bit!`);
      }
    }
  }

  async _say(message) {
    try {
      await this.client.say(this.channel, message);
    } catch (err) {
      console.error('[IkaEXE] Failed to send message:', err.message);
    }
  }

  _parseTier(plan) {
    const tiers = { '1000': 1, '2000': 2, '3000': 3, Prime: 'Prime' };
    return tiers[plan] || 1;
  }

  /**
   * Public method to fire a follow event.
   * Called from the EventSub relay since tmi.js doesn't get follow events.
   */
  onFollow(username) {
    this._handleEvent('follow', { username });
  }

  async connect() {
    this.streamStatus.start(60_000); // check live status every 60s
    await this.client.connect();
  }

  async disconnect() {
    this.streamStatus.stop();
    await this.client.disconnect();
  }
}
