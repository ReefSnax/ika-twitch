/**
 * StreamStatus
 * Polls the Twitch Helix API to check if the channel is live.
 * Stores current stream info (title, game) for the showstarter.
 */
export class StreamStatus {
  constructor() {
    this.isLive = false;
    this.currentStream = null; // { title, game } or null
    this._prevLive = null; // null = unknown (first check)
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.pollInterval = null;
    /** @type {Set<function>} */
    this._liveChangeCallbacks = new Set();
  }

  /**
   * Register a callback for live-status changes.
   * Callback receives ({ isLive: boolean, stream: object|null }).
   */
  onLiveChange(callback) {
    this._liveChangeCallbacks.add(callback);
  }

  async getAppToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
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
    this.accessToken = data.access_token;
    // Expire a minute early to be safe
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  async checkLive() {
    try {
      const token = await this.getAppToken();
      const res = await fetch(
        `https://api.twitch.tv/helix/streams?user_login=${process.env.TWITCH_CHANNEL}`,
        {
          headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const data = await res.json();
      const streamData = data.data?.[0] || null;
      const nowLive = !!streamData;

      this.isLive = nowLive;

      // Store current stream info for showstarter
      if (streamData) {
        this.currentStream = {
          title: streamData.title,
          game: streamData.game_name,
        };
      } else {
        this.currentStream = null;
      }

      // Fire callbacks on status change (skip first check — that's initialization)
      if (this._prevLive !== null && nowLive !== this._prevLive) {
        console.log(`[StreamStatus] Live status changed: ${this._prevLive} -> ${nowLive}`);
        const payload = { isLive: nowLive, stream: this.currentStream };
        for (const cb of this._liveChangeCallbacks) {
          try { cb(payload); } catch (e) { console.error('[StreamStatus] Callback error:', e.message); }
        }
      }
      this._prevLive = nowLive;
    } catch (err) {
      console.error('[StreamStatus] Failed to check live status:', err.message);
      // Don't flip isLive on error -- assume current state is still valid
    }
  }

  start(intervalMs = 60_000) {
    this.checkLive(); // immediate first check
    this.pollInterval = setInterval(() => this.checkLive(), intervalMs);
    console.log(`[StreamStatus] Polling every ${intervalMs / 1000}s`);
  }

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }
}
