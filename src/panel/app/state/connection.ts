/** Connection labels the transports and controller report in `Snapshot.connection`. */
export const CONNECTION = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed",
  hostRequired: "Open through MCP",
} as const;

export type ConnectionLabel = (typeof CONNECTION)[keyof typeof CONNECTION];

/** Whether the panel lost a connection it had or failed to make one, which the header shows. */
export function connectionTrouble(connection: ConnectionLabel) {
  return (
    connection === CONNECTION.reconnecting || connection === CONNECTION.failed
  );
}
