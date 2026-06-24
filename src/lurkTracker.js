/**
 * LurkTracker — in-memory tracking for !lurk command.
 *
 * Tracks which users have declared themselves lurking.
 * When a lurking user speaks again, they get a one-time welcome-back message.
 * Lurk state is per-session (not persisted across bot restarts).
 */
export class LurkTracker {
  constructor() {
    /** @type {Set<string>} Lowercase usernames currently lurking */
    this._lurkers = new Set();
  }

  /** Mark a user as lurking. Returns true if they weren't already lurking. */
  startLurk(username) {
    const key = username.toLowerCase();
    if (this._lurkers.has(key)) return false;
    this._lurkers.add(key);
    return true;
  }

  /**
   * Check if a user is lurking. If so, remove them from the lurk list
   * and return true (indicating they should get a welcome-back message).
   * Returns false if they weren't lurking.
   */
  checkReturn(username) {
    const key = username.toLowerCase();
    if (!this._lurkers.has(key)) return false;
    this._lurkers.delete(key);
    return true;
  }

  /** Number of active lurkers */
  get count() {
    return this._lurkers.size;
  }
}
