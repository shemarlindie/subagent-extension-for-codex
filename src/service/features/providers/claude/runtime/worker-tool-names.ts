/**
 * The worker-facing MCP server's name. It joins the user's own servers when a
 * session loads them, so it has to be one a user is unlikely to pick.
 */
export const WORKER_SERVER = "subx";

/** A worker tool's name as Claude Code exposes and calls it. */
export const workerTool = (name: string) => `mcp__${WORKER_SERVER}__${name}`;

/** The tool names Claude Code calls, for the settings allow rule. */
export const workerToolNames = [
  "update_plan",
  "show_visual",
  "visual_guide",
  "wrap_up",
].map(workerTool);

/**
 * Calls to these show no tool rows. Kept apart from the server, so the event
 * normalizer doesn't load the SDK.
 */
export const isWorkerTool = (name: string) => workerToolNames.includes(name);
