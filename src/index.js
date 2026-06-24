import 'dotenv/config';
import { TwitchBot } from './bot.js';
import { startEventSubRelay } from './eventSubRelay.js';

const bot = new TwitchBot();
startEventSubRelay(bot, parseInt(process.env.EVENTSUB_PORT || '3456'));
bot.connect();
