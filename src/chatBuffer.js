/**
 * ChatBuffer
 * Maintains a rolling window of recent chat messages.
 * Used to give Ika context when responding to direct mentions.
 */
export class ChatBuffer {
  constructor(maxMessages = 20) {
    this.maxMessages = maxMessages;
    this.messages = [];
  }

  add(username, text) {
    this.messages.push({ username, text, ts: Date.now() });
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }

  /**
   * Returns recent messages formatted for the Anthropic API.
   * Alternates user/assistant roles as required by the API.
   * We pack the context into a single user message to avoid role alternation issues.
   */
  getContext(limit = 10) {
    const recent = this.messages.slice(-limit);
    if (recent.length === 0) return [];

    const contextText = recent
      .map((m) => `${m.username}: ${m.text}`)
      .join('\n');

    return [
      {
        role: 'user',
        content: `Recent chat context (last ${recent.length} messages):\n${contextText}`,
      },
    ];
  }
}
