import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** The message when it is an informational notice from Claude Code. */
export const informational = (raw: SDKMessage | undefined) =>
  raw?.type === "system" && raw.subtype === "informational" ? raw : undefined;

/** Names an informational message by its level, as Claude Code ranks them. */
export function informationalTitle(raw: SDKMessage | undefined) {
  const message = informational(raw);

  if (message?.prevent_continuation) return "Claude stopped";
  if (message?.level === "warning") return "Claude warning";
  if (message?.level === "suggestion") return "Claude suggestion";

  return "Claude note";
}

const writeFailures: Record<string, string> = {
  ENOSPC: "The disk is full.",
  EDQUOT: "The disk quota is used up.",
};

/** Says why Claude couldn't save its session and what that loses. */
export function sessionWritesLostSummary(raw: SDKMessage | undefined) {
  if (raw?.type !== "system" || raw.subtype !== "session_writes_lost") {
    return undefined;
  }

  return [
    writeFailures[raw.error_code] ?? "Claude couldn't write to disk.",
    raw.lost.includes("transcript") &&
      "Part of a session transcript wasn't saved, so resuming that session may leave out part of its conversation.",
    raw.lost.includes("global_config") &&
      "Changes to Claude's settings in ~/.claude.json weren't saved.",
  ]
    .filter(Boolean)
    .join(" ");
}
