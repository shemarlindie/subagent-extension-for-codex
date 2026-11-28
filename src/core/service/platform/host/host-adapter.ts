/**
 * Chat context a host attaches to an MCP call. Hints correlate and suggest,
 * and never grant access.
 */
export interface HostHints {
  /** The chat's working directory as a local `file:` URI. */
  directory?: string;
  /** The host's chat or session identifier. */
  conversation?: string;
}
