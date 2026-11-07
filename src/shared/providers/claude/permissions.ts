import { z } from "zod";

import { titleCase } from "../../text.js";

export const claudePermissionModes = [
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "auto",
  "bypassPermissions",
] as const;

/** Modes the extension stores and always passes to the Claude SDK. */
export const claudePermissionModeSchema = z.enum(claudePermissionModes);

export type ClaudePermissionMode = z.infer<typeof claudePermissionModeSchema>;

export const permissionModeSchema = z.enum([
  "inherit",
  ...claudePermissionModes,
]);

export type PermissionMode = z.infer<typeof permissionModeSchema>;

export type ClaudeOverrides = {
  /** Runs Bash in Claude Code's sandbox. Off leaves it to Claude Code settings. */
  sandbox: boolean;
  subagents: boolean;
  settings_files: boolean;
  user_mcp: boolean;
};

// Other Claude Code configuration loads by default; the extension owns the
// session's native permission mode.
export const claudeOverrideDefaults: ClaudeOverrides = {
  sandbox: false,
  subagents: true,
  settings_files: true,
  user_mcp: true,
};

const permissionLabels: Partial<
  Record<ClaudePermissionMode | "inherit", string>
> = {
  inherit: "Use extension setting",
  default: "Default — ask for approval",
  acceptEdits: "Accept edits",
  plan: "Plan — read only",
  dontAsk: "Don't ask — deny unapproved actions",
  auto: "Auto — Claude Code decides",
  bypassPermissions: "Bypass permission prompts",
};

/** The reason a mode is blocked when org policy turned it off. */
export const MODE_TURNED_OFF_BY_ORG = "Turned off by your organization";

export function permissionLabel(mode: ClaudePermissionMode | "inherit") {
  return permissionLabels[mode] ?? mode;
}

/** A mode's short name, as notes and warnings call it. */
export const permissionModeName = (mode: string) =>
  shortPermissionLabel(permissionLabel(mode as ClaudePermissionMode));

/**
 * A permission mode's label shortened for a chip: "Plan — read only" reads
 * "Plan", and the default mode reads by what it does, "Ask for approval".
 */
export function shortPermissionLabel(label: string) {
  if (label === "Use extension setting") return "Extension setting";

  const [name = label, detail] = label.split(" — ");

  return name === "Default" && detail ? titleCase(detail) : name;
}

const permissionRank: Partial<Record<ClaudePermissionMode, number>> = {
  plan: 0,
  dontAsk: 1,
  default: 2,
  acceptEdits: 3,
  auto: 4,
  bypassPermissions: 5,
};

export const readOnlyProfile = (role: string) =>
  ["researcher", "reviewer", "security_reviewer"].includes(role);

/**
 * A task's mode: the one it asks for, else `plan` for a read-only profile,
 * else the saved setting.
 */
export function resolveClaudePermission(
  input: { permission_mode?: PermissionMode },
  configured: ClaudePermissionMode,
  workerProfile: string,
) {
  if (input.permission_mode && input.permission_mode !== "inherit") {
    return { mode: input.permission_mode, source: "task" as const };
  }

  if (readOnlyProfile(workerProfile)) {
    return { mode: "plan" as const, source: "profile" as const };
  }

  return { mode: configured, source: "setting" as const };
}

/** Whether a model-selected mode could allow more than the user-approved baseline. */
export function exceedsPermission(
  requested: ClaudePermissionMode,
  baseline: ClaudePermissionMode,
) {
  if (requested === baseline) return false;

  const requestedRank = permissionRank[requested],
    baselineRank = permissionRank[baseline];

  // An SDK mode without an explicit rank has unknown policy; fail closed when
  // comparing it with a different mode until its behavior is reviewed.
  if (requestedRank === undefined || baselineRank === undefined) return true;

  return requestedRank > baselineRank;
}

export const claudePolicySchema = z.object({
  sandbox: z.boolean(),
  subagents: z.boolean(),
  /** Load the user's, project's and local Claude Code settings. */
  settings_files: z.boolean(),
  /** Offer MCP servers from the user's Claude Code configuration alongside the extension's own. */
  user_mcp: z.boolean(),
});

export type ClaudePolicy = z.infer<typeof claudePolicySchema>;

/** The settings a task keeps, with the sandbox it asked for, if any. */
export const resolveClaudePolicy = (
  overrides: ClaudeOverrides,
  sandbox = overrides.sandbox,
): ClaudePolicy => ({
  sandbox,
  subagents: overrides.subagents,
  settings_files: overrides.settings_files,
  user_mcp: overrides.user_mcp,
});
