/**
 * EventSub Relay
 *
 * Twitch follow events are not available via IRC (tmi.js).
 * They require EventSub, which delivers via webhook or WebSocket.
 *
 * This module runs a small HTTP server that:
 * 1. Verifies the Twitch EventSub signature
 * 2. Handles the challenge handshake on subscription
 * 3. Fires bot.onFollow() when a follow event arrives
 *
 * You'll need to register the subscription once via the Twitch CLI or API.
 * See README for the setup command.
 */

import http from 'http';
import crypto from 'crypto';

const TWITCH_MESSAGE_ID = 'twitch-eventsub-message-id';
const TWITCH_MESSAGE_TIMESTAMP = 'twitch-eventsub-message-timestamp';
const TWITCH_MESSAGE_SIGNATURE = 'twitch-eventsub-message-signature';
const MESSAGE_TYPE = 'twitch-eventsub-message-type';

const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';
const MESSAGE_TYPE_NOTIFICATION = 'notification';
const MESSAGE_TYPE_REVOCATION = 'revocation';

function verifySignature(secret, headers, rawBody) {
  const msgId = headers[TWITCH_MESSAGE_ID];
  const timestamp = headers[TWITCH_MESSAGE_TIMESTAMP];
  const signature = headers[TWITCH_MESSAGE_SIGNATURE];

  const hmacMessage = msgId + timestamp + rawBody;
  const hmac =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(hmacMessage).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

export function startEventSubRelay(bot, port = 3456) {
  const secret = process.env.EVENTSUB_SECRET;
  if (!secret) {
    console.warn('[EventSub] EVENTSUB_SECRET not set -- relay not started. Follow events will not work.');
    return;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/eventsub') {
      res.writeHead(404).end();
      return;
    }

    let rawBody = '';
    req.on('data', (chunk) => (rawBody += chunk));
    req.on('end', () => {
      try {
        if (!verifySignature(secret, req.headers, rawBody)) {
          console.warn('[EventSub] Signature verification failed');
          res.writeHead(403).end();
          return;
        }

        const body = JSON.parse(rawBody);
        const messageType = req.headers[MESSAGE_TYPE];

        if (messageType === MESSAGE_TYPE_VERIFICATION) {
          // Respond to Twitch's challenge to confirm the subscription
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(body.challenge);
          console.log('[EventSub] Subscription verified');
          return;
        }

        if (messageType === MESSAGE_TYPE_NOTIFICATION) {
          res.writeHead(204).end();
          const { subscription, event } = body;

          if (subscription.type === 'channel.follow') {
            console.log(`[EventSub] Follow: ${event.user_name}`);
            bot.onFollow(event.user_name);
          }
          return;
        }

        if (messageType === MESSAGE_TYPE_REVOCATION) {
          console.warn(`[EventSub] Subscription revoked: ${body.subscription.type}`);
          res.writeHead(204).end();
          return;
        }

        res.writeHead(204).end();
      } catch (err) {
        console.error('[EventSub] Error processing request:', err.message);
        res.writeHead(500).end();
      }
    });
  });

  server.listen(port, () => {
    console.log(`[EventSub] Relay listening on port ${port}`);
  });

  return server;
}
