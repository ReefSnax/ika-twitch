import tmi from 'tmi.js';
import {
  generateEventResponse,
  generateChatResponse,
  generateShoutout,
  generateLurkResponse,
  generateReturnResponse,
  generateShowstarter,
  generateCelebration,
} from './ai.js';
import { lookupShoutoutData, getUserInfo, getBotUserId, triggerNativeShoutout } from './twitchApi.js';
import { StreamStatus } from './streamStatus.js';
import { ChatBuffer } from './chatBuffer.js';
import { LurkTracker } from './lurkTracker.js';
import { MilestoneTracker } from './milestones.js';

// Names Ika should respond to in chat
// Uses word boundaries so "Pikachu" doesn't trigger but "@ika" / "ika?" / "ikaexe" do.
const IKA_TRIGGER_REGEX = /\b(?:ika|ikaexe|ikazuchi)\b/i;

// Detect native /shoutout system messages from Twitch
// Pattern: "<name> shouted out <target>!" or "<name> is giving a Shoutout to <target>!"
const SHOUTOUT_SYSTEM_REGEX = /shout(?:ed\s+out|out)\s+([A-Za-z]\w{2,24})/i;

// Track usernames we just shouted out via !shoutout so we don't double-respond
const RECENT_SO = new Set();

export class TwitchBot {
  constructor() {
    this.channel = process.env.TWITCH_CHANNEL;
    this.streamStatus = new StreamStatus();
    this.chatBuffer = new ChatBuffer(); // stores 40 messages by default

    this.client = new tmi.Client({
      options: { debug: process.env.DEBUG === 'true' },
      identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: process.env.TWITCH_OAUTH_TOKEN, // oauth:xxxx format
      },
      channels: [this.channel],
    });

    this.lurkTracker = new LurkTracker();
    this.milestones = new MilestoneTracker();

    this._bindEvents();

    // Wire showstarter — fires when stream goes live
    this.streamStatus.onLiveChange(({ isLive, stream }) => {
      if (isLive) this._handleShowstarter(stream);
    });
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

      // Check for !lurk command
      const lurkMatch = message.match(/^!lurk\b/i);
      if (lurkMatch) {
        this._handleLurk(channel, username);
        return;
      }

      // Check if a lurker has returned — one-time welcome back
      if (this.lurkTracker.checkReturn(username)) {
        this._handleReturn(channel, username);
        // Don't return — let them still trigger other commands
      }

      // Check for !shoutout command
      const shoutoutMatch = message.match(/^!shoutout\s+@?(\w+)/i);
      if (shoutoutMatch) {
        const target = shoutoutMatch[1];
        this._handleShoutout(channel, username, target);
        return;
      }

      // Detect native /shoutout system message from Twitch
      if (SHOUTOUT_SYSTEM_REGEX.test(message)) {
        const target = message.match(SHOUTOUT_SYSTEM_REGEX)[1].toLowerCase();
        // Don't double-respond if we triggered it ourselves
        if (RECENT_SO.has(target)) {
          RECENT_SO.delete(target);
        } else {
          this._handleNativeShoutout(channel, target);
        }
      }

      // Check if Ika is being addressed (word-boundary match, so "Pikachu" won't trigger)
      const mentioned = IKA_TRIGGER_REGEX.test(message);
      if (mentioned) {
        this._handleChatMention(channel, username, message);
      }
    });

    // --- Subscriptions ---
    this.client.on('subscription', (channel, username, method, message, userstate) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('sub', {
        username: userstate['display-name'] || username,
        months: 1,
        tier: this._parseTier(method?.plan),
        message,
      });
      this._checkSubMilestone();
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
      this._checkSubMilestone();
    });

    this.client.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('subgift', {
        username: userstate['display-name'] || username,
        recipient,
        count: 1,
      });
      this._checkSubMilestone();
    });

    this.client.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
      if (!this.streamStatus.isLive) return;
      this._handleEvent('subgift', {
        username: userstate['display-name'] || username,
        recipient: null,
        count: numbOfSubs,
      });
      // Track each gifted sub as a milestone increment
      for (let i = 0; i < numbOfSubs; i++) {
        this._checkSubMilestone();
      }
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

      // Attach recent chat as vibe context
      const chatContext = this.chatBuffer.getContext(20);
      const response = await generateEventResponse(type, {
        ...context,
        chatContext,
      });

      await this._say(response);
    } catch (err) {
      console.error(`[IkaEXE] Error handling ${type} event:`, err.message);
    }
  }

  async _handleChatMention(channel, username, message) {
    try {
      const context = this.chatBuffer.getContext(20);
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

      // Mark as recently triggered so the system-message detector skips it
      RECENT_SO.add(target.toLowerCase());
      setTimeout(() => RECENT_SO.delete(target.toLowerCase()), 5000);

      // Try to trigger native Twitch /shoutout via API first
      try {
        const botId = await getBotUserId();
        const [chUser, tgUser] = await Promise.all([
          getUserInfo(this.channel.replace('#', '')),
          getUserInfo(target),
        ]);
        if (botId && chUser && tgUser) {
          await triggerNativeShoutout(tgUser.id, chUser.id, botId);
          console.log(`[IkaEXE] Native shoutout triggered via API for ${target}`);
        }
      } catch (apiErr) {
        // If API fails (wrong scope, not a mod, etc.), fall back to IRC command
        console.log(`[IkaEXE] API shoutout failed, trying IRC: ${apiErr.message}`);
        try {
          await this.client.say(this.channel, `/shoutout ${target}`);
        } catch (ircErr) {
          console.log(`[IkaEXE] IRC shoutout also failed: ${ircErr.message}`);
        }
      }

      // Now post the AI-generated shoutout message
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

  async _handleNativeShoutout(channel, target) {
    try {
      console.log(`[IkaEXE] Detected native shoutout for ${target}`);
      const data = await lookupShoutoutData(target);
      const shoutout = await generateShoutout(data);
      const message = `Check out ${target} over at https://twitch.tv/${target} — ${shoutout}`;
      const trimmed = message.slice(0, 490);
      await this._say(trimmed);
    } catch (err) {
      console.error(`[IkaEXE] Native shoutout response failed for ${target}:`, err.message);
      // Silently fail — don't spam chat with error messages
    }
  }

  async _handleLurk(channel, username) {
    try {
      const chatContext = this.chatBuffer.getContext(20);
      const response = await generateLurkResponse(username, chatContext);
      const trimmed = response.slice(0, 490);
      await this._say(trimmed);
      this.lurkTracker.startLurk(username);
      console.log(`[IkaEXE] ${username} is now lurking`);
    } catch (err) {
      console.error('[IkaEXE] Error handling !lurk:', err.message);
    }
  }

  async _handleReturn(channel, username) {
    try {
      const chatContext = this.chatBuffer.getContext(20);
      const response = await generateReturnResponse(username, chatContext);
      const trimmed = response.slice(0, 490);
      await this._say(trimmed);
      console.log(`[IkaEXE] ${username} returned from lurking`);
    } catch (err) {
      console.error('[IkaEXE] Error handling lurk return:', err.message);
    }
  }

  async _handleShowstarter(stream) {
    try {
      const response = await generateShowstarter(stream);
      const trimmed = response.slice(0, 490);
      await this._say(trimmed);
      console.log('[IkaEXE] Showstarter fired — stream is live!');
    } catch (err) {
      console.error('[IkaEXE] Error handling showstarter:', err.message);
    }
  }

  async _handleCelebration(type, milestone) {
    try {
      const chatContext = this.chatBuffer.getContext(20);
      const response = await generateCelebration(type, milestone, chatContext);
      const trimmed = response.slice(0, 490);
      await this._say(trimmed);
      console.log(`[IkaEXE] ${type} milestone ${milestone} celebrated!`);
    } catch (err) {
      console.error('[IkaEXE] Error handling celebration:', err.message);
    }
  }

  _checkSubMilestone() {
    const milestone = this.milestones.recordSub();
    if (milestone) {
      this._handleCelebration('sub', milestone);
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

    // Milestone tracking
    const milestone = this.milestones.recordFollow();
    if (milestone) {
      this._handleCelebration('follow', milestone);
    }
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
