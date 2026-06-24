/**
 * MilestoneTracker — persistent count tracking for follows and subs.
 *
 * Keeps a JSON state file with running counts. When a count crosses
 * a defined milestone threshold, returns which milestone was hit so
 * the bot can fire a celebration.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, '..', 'milestone-state.json');

// Milestone thresholds
const FOLLOW_MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 5000];
const SUB_MILESTONES     = [10, 25, 50, 100, 150, 200, 250, 500, 1000];

function load() {
  if (!existsSync(STATE_PATH)) {
    return { totalFollows: 0, totalSubs: 0, celebratedFollows: [], celebratedSubs: [] };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { totalFollows: 0, totalSubs: 0, celebratedFollows: [], celebratedSubs: [] };
  }
}

function save(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export class MilestoneTracker {
  constructor() {
    this.state = load();
  }

  /**
   * Register a follow event. Returns the milestone number if a milestone was
   * just crossed, or null otherwise.
   */
  recordFollow() {
    this.state.totalFollows++;
    const milestone = this._checkMilestone(this.state.totalFollows, FOLLOW_MILESTONES, this.state.celebratedFollows);
    if (milestone) this.state.celebratedFollows.push(milestone);
    save(this.state);
    return milestone;
  }

  /**
   * Register a sub event. Returns the milestone number if a milestone was
   * just crossed, or null otherwise.
   */
  recordSub() {
    this.state.totalSubs++;
    const milestone = this._checkMilestone(this.state.totalSubs, SUB_MILESTONES, this.state.celebratedSubs);
    if (milestone) this.state.celebratedSubs.push(milestone);
    save(this.state);
    return milestone;
  }

  _checkMilestone(current, milestones, celebrated) {
    for (const m of milestones) {
      if (current === m && !celebrated.includes(m)) return m;
    }
    return null;
  }

  getFollowCount()  { return this.state.totalFollows; }
  getSubCount()     { return this.state.totalSubs; }
}
