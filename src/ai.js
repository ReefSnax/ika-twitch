import Anthropic from '@anthropic-ai/sdk';
import { IKA_SYSTEM_PROMPT, CHAT_RESPONSE_SYSTEM_PROMPT } from './persona.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Format chat context into a string for injecting into prompts.
 */
function formatChatContext(messages, label) {
  if (!messages || messages.length === 0) return '';
  const contextText = messages
    .map((m) => `${m.username}: ${m.text}`)
    .join('\n');
  return `\n\n${label} (${messages.length} messages):\n${contextText}`;
}

/**
 * Generate a Twitch event response (follow, sub, raid, bits)
 * Uses a single-shot prompt — no conversation history needed.
 * @param {string} eventType
 * @param {object} context — event data plus optional chatContext (array of {username, text})
 */
export async function generateEventResponse(eventType, context) {
  const { chatContext, ...eventData } = context;

  let promptBase = '';

  switch (eventType) {
    case 'follow':
      promptBase =
        `A new follower just joined! Their username is: ${eventData.username}. Write a short, warm welcome that feels personal. Reference their name naturally. Keep it under 200 characters.`;
      break;

    case 'sub':
      promptBase =
        `${eventData.username} just subscribed${eventData.months > 1 ? ` for ${eventData.months} months` : ''}${eventData.tier ? ` at Tier ${eventData.tier}` : ''}. ${eventData.message ? `Their sub message: "${eventData.message}"` : 'No sub message.'} Thank them and acknowledge the support. Keep it under 200 characters.`;
      break;

    case 'resub':
      promptBase =
        `${eventData.username} just resubscribed for ${eventData.months} months${eventData.streak ? ` (${eventData.streak} month streak)` : ''}${eventData.tier ? ` at Tier ${eventData.tier}` : ''}. ${eventData.message ? `Their message: "${eventData.message}"` : ''} Acknowledge their loyalty and thank them. Keep it under 200 characters.`;
      break;

    case 'subgift':
      promptBase =
        `${eventData.username} just gifted ${eventData.count} sub${eventData.count > 1 ? 's' : ''}${eventData.recipient ? ` to ${eventData.recipient}` : ' (random recipients)'}. Thank them for the generosity. Keep it under 200 characters.`;
      break;

    case 'bits':
      promptBase =
        `${eventData.username} just cheered ${eventData.amount} bits${eventData.message ? `. Their message: "${eventData.message}"` : ''}. Acknowledge the contribution and thank them. Keep it under 200 characters.`;
      break;

    case 'raid':
      promptBase =
        `${eventData.username} is raiding with ${eventData.viewers} viewer${eventData.viewers !== 1 ? 's' : ''}! Welcome the raid party and address ${eventData.username} directly. Keep it under 200 characters.`;
      break;

    default:
      throw new Error(`Unknown event type: ${eventType}`);
  }

  const chatSuffix = formatChatContext(chatContext, 'Recent chat vibe');
  const userPrompt = `${promptBase}${chatSuffix}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    system: IKA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Generate a chat response when someone mentions Ika directly.
 * Accepts a short message history for context.
 */
export async function generateChatResponse(messages) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    system: CHAT_RESPONSE_SYSTEM_PROMPT,
    messages,
  });

  return response.content[0].text.trim();
}

/**
 * Pronoun grammar helper: returns the correct pronoun set for the given format.
 * @param {string|null} pronouns - e.g. "she/her", "he/him", "they/them"
 * @param {'subject'|'object'|'possessive'|'reflexive'} form
 */
function pronoun(pronouns, form) {
  const forms = {
    'she/her':  { subject: 'she', object: 'her', possessive: 'her', reflexive: 'herself' },
    'he/him':   { subject: 'he', object: 'him', possessive: 'his', reflexive: 'himself' },
    'they/them':{ subject: 'they', object: 'them', possessive: 'their', reflexive: 'themself' },
  };
  const set = forms[pronouns] || forms['they/them'];
  return set[form];
}

/**
 * Generate a unique friendly shoutout for a Twitch user.
 */
export async function generateShoutout(data) {
  const { displayName, description, stream, pronouns } = data;
  const subj = pronoun(pronouns, 'subject');
  const obj = pronoun(pronouns, 'object');
  const poss = pronoun(pronouns, 'possessive');

  let prompt = `Write a short, friendly shoutout for a Twitch streamer named "${displayName}".`;

  if (pronouns) {
    prompt += ` Use ${pronouns} pronouns when referring to ${obj}.`;
  }

  if (description) {
    prompt += ` ${poss} Twitch bio says: "${description.slice(0, 200)}"`;
  }

  if (stream) {
    prompt += ` ${subj.toUpperCase()} IS LIVE! Streaming "${stream.title}" in the "${stream.game}" category.`;
  } else {
    prompt += ` ${subj.toUpperCase()} might not be live right now, but ${subj}'s still worth checking out!`;
  }

  prompt += `\n\nWrite ONE sentence. Be warm, unique, and natural. Never mention politics, ethnicity, race, gender identity, or anything sensitive. Stick to their content, vibe, and what they stream. Make it feel like a genuine recommendation. Max 450 characters.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 120,
    system: IKA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Generate a response when someone uses !lurk.
 * @param {string} username
 * @param {Array<{username:string,text:string}>} [chatContext] — optional recent chat messages
 */
export async function generateLurkResponse(username, chatContext) {
  const chatSuffix = formatChatContext(chatContext, 'Recent chat vibe');
  const prompt = `${username} just typed !lurk in chat. Write a short, friendly acknowledgment — let them know their lurking is noted, tell them to enjoy the rest of the stream. Keep it under 200 characters. Vary your phrasing each time — switch up the imagery, don't always default to ocean metaphors.${chatSuffix}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 80,
    system: IKA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text.trim();
}

/**
 * Generate a welcome-back message when a lurker speaks again.
 * @param {string} username
 * @param {Array<{username:string,text:string}>} [chatContext] — optional recent chat messages
 */
export async function generateReturnResponse(username, chatContext) {
  const chatSuffix = formatChatContext(chatContext, 'Recent chat vibe');
  const prompt = `${username} was lurking and just spoke up again in chat. Write a short, playful "welcome back" message — acknowledge them surfacing, but don't default to ocean metaphors every time. Keep it under 200 characters.${chatSuffix}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 80,
    system: IKA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text.trim();
}

/**
 * Generate a "we're live!" announcement when the stream starts.
 * @param {object} [stream] — current stream info {title, game} from Helix API (optional)
 */
export async function generateShowstarter(stream) {
  let prompt;
  if (stream) {
    prompt =
      `The stream just went live! Snax is playing "${stream.game}" — "${stream.title}". Write a short, energetic announcement welcoming viewers old and new. Reference the game naturally. Keep it under 300 characters. Don't use the phrase "signal is green" or any variation.`;
  } else {
    prompt =
      `The stream just went live! Write a short, energetic "we're live" announcement welcoming viewers old and new. Keep it under 300 characters. Don't use the phrase "signal is green" or any variation.`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 120,
    system: IKA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text.trim();
}

/**
 * Generate a milestone celebration message.
 * @param {'follow'|'sub'} type
 * @param {number} milestone — the number reached
 * @param {Array<{username:string,text:string}>} [chatContext] — optional recent chat messages
 */
export async function generateCelebration(type, milestone, chatContext) {
  const label = type === 'follow' ? 'followers' : 'subscribers';
  const chatSuffix = formatChatContext(chatContext, 'Recent chat vibe');
  const prompt = `Celebration time! The channel just reached ${milestone} ${label}! Write a short, excited message thanking the community and acknowledging this milestone. Keep it under 300 characters. Make it feel genuine, not corporate.${chatSuffix}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 120,
    system: IKA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text.trim();
}
