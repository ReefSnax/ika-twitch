import Anthropic from '@anthropic-ai/sdk';
import { IKA_SYSTEM_PROMPT, CHAT_RESPONSE_SYSTEM_PROMPT } from './persona.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate a Twitch event response (follow, sub, raid, bits)
 * Uses a single-shot prompt -- no conversation history needed.
 */
export async function generateEventResponse(eventType, context) {
  const prompts = {
    follow: `A new follower just joined the channel. Their username is: ${context.username}. Write a short, personalized welcome message. Don't just say their name and "welcome" -- make it feel real.`,

    sub: `${context.username} just subscribed${context.months > 1 ? ` for ${context.months} months` : ''}${context.tier ? ` at Tier ${context.tier}` : ''}. ${context.message ? `Their sub message: "${context.message}"` : 'No sub message.'} Thank them in character.`,

    resub: `${context.username} just resubscribed for ${context.months} months${context.streak ? ` (${context.streak} month streak)` : ''}${context.tier ? ` at Tier ${context.tier}` : ''}. ${context.message ? `Their message: "${context.message}"` : ''} Acknowledge the loyalty.`,

    subgift: `${context.username} just gifted ${context.count} sub${context.count > 1 ? 's' : ''} to the channel${context.recipient ? ` to ${context.recipient}` : ' (random recipients)'}. Thank them for the generosity.`,

    bits: `${context.username} just cheered ${context.amount} bits${context.message ? `. Their message: "${context.message}"` : ''}. Acknowledge the contribution.`,

    raid: `${context.username} is raiding the channel with ${context.viewers} viewer${context.viewers !== 1 ? 's' : ''}. Welcome the raid party. Address ${context.username} directly and welcome their community to the Reef.`,
  };

  const userPrompt = prompts[eventType];
  if (!userPrompt) throw new Error(`Unknown event type: ${eventType}`);

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
