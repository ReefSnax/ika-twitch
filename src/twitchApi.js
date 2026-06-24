/**
 * Twitch Helix API helpers
 * Provides user lookup, stream info, and channel tags (including pronouns).
 */

const HELIX_USERS = 'https://api.twitch.tv/helix/users';
const HELIX_STREAMS = 'https://api.twitch.tv/helix/streams';
const HELIX_CHANNELS = 'https://api.twitch.tv/helix/channels';

let accessToken = null;
let tokenExpiry = 0;

async function getAppToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

function getHeaders() {
  return {
    'Client-ID': process.env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Look up a Twitch user by login name.
 * Returns: { id, display_name, description, profile_image_url } or null.
 */
export async function getUserInfo(login) {
  await getAppToken();
  const res = await fetch(`${HELIX_USERS}?login=${encodeURIComponent(login)}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  return data.data?.[0] || null;
}

/**
 * Get the current stream info for a user.
 * Returns: { title, game_name } or null (if not live).
 */
export async function getStreamInfo(userId) {
  await getAppToken();
  const res = await fetch(`${HELIX_STREAMS}?user_id=${userId}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  if (!data.data?.[0]) return null;
  const s = data.data[0];
  return { title: s.title, game_name: s.game_name };
}

/**
 * Get channel info (tags, which may include pronouns).
 * Returns: { tags: string[] } or null.
 */
export async function getChannelInfo(userId) {
  await getAppToken();
  const res = await fetch(`${HELIX_CHANNELS}?broadcaster_id=${userId}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  return data.data?.[0] || null;
}

/**
 * Extract pronouns from channel tags.
 * Looks for common pronoun patterns.
 * Returns: string (e.g. "she/her") or null.
 */
export function extractPronouns(tags) {
  if (!tags || !Array.isArray(tags)) return null;
  const patterns = [
    /she\/her/i, /he\/him/i, /they\/them/i, /she\/they/i, /he\/they/i,
    /any pronouns/i, /ze\/hir/i, /ze\/zir/i, /it\/its/i, /ey\/em/i, /fae\/faer/i,
  ];
  for (const tag of tags) {
    for (const pattern of patterns) {
      if (pattern.test(tag)) return pattern.source.replace(/\\\//g, '/');
    }
  }
  return null;
}

/**
 * Lookup all shoutout-relevant data for a given username.
 * Returns: { displayName, description, stream, pronouns } or throws if user not found.
 */
export async function lookupShoutoutData(login) {
  const user = await getUserInfo(login);
  if (!user) throw new Error(`User "${login}" not found`);

  const [stream, channel] = await Promise.all([
    getStreamInfo(user.id),
    getChannelInfo(user.id),
  ]);

  const pronouns = channel ? extractPronouns(channel.tags) : null;

  return {
    displayName: user.display_name,
    description: user.description || null,
    stream: stream ? { title: stream.title, game: stream.game_name } : null,
    pronouns,
  };
}
