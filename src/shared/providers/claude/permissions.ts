import { z } from "zod";

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

// Optional restrictions on delegated Claude sessions. "profile" applies the
// worker profile's bundle: read-only profiles restrict, write profiles don't.
export const claudeSandboxSchema = z.enum([
  "user_config",
  "extension",
  "extension_locked",
]);

export const claudeToolsSchema = z.enum(["profile", "all", "restricted"]);
export const claudePathGuardSchema = z.enum(["profile", "on", "off"]);

export type ClaudeOverrides = {
  sandbox: z.infer<typeof claudeSandboxSchema>;
  tools: z.infer<typeof claudeToolsSchema>;
  path_guard: z.infer<typeof claudePathGuardSchema>;
  subagents: boolean;
  settings_files: boolean;
  user_mcp: boolean;
};

// Other Claude Code configuration loads by default; the extension owns the
// session's native permission mode.
export const claudeOverrideDefaults: ClaudeOverrides = {
  sandbox: "user_config",
  tools: "profile",
  path_guard: "profile",
  subagents: true,
  settings_files: true,
  user_mcp: true,
};

/** Labels for each choice of the non-switch overrides. */
type ClaudeOverrideLabels = {
  [
    K in keyof ClaudeOverrides as ClaudeOverrides[K] extends string ? K : never
  ]: Record<Extract<ClaudeOverrides[K], string>, string>;
};

export const claudeOverrideLabels: ClaudeOverrideLabels = {
  sandbox: {
    user_config: "Your Claude Code settings",
    extension: "Extension sandbox",
    extension_locked: "Extension sandbox with locked network",
  },
  tools: {
    profile: "By worker profile",
    all: "All tools",
    restricted: "Restricted set",
  },
  path_guard: {
    profile: "By worker profile",
    on: "On",
    off: "Off",
  },
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

export function permissionLabel(mode: ClaudePermissionMode | "inherit") {
  return permissionLabels[mode] ?? mode;
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

export function resolveClaudePermission(
  input: { permission_mode?: PermissionMode },
  configured: ClaudePermissionMode,
) {
  if (input.permission_mode && input.permission_mode !== "inherit") {
    return { mode: input.permission_mode, source: "task" as const };
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
  sandbox: claudeSandboxSchema,
  tools: z.enum(["all", "restricted"]),
  path_guard: z.boolean(),
  subagents: z.boolean(),
  /** Load the user's, project's and local Claude Code settings. */
  settings_files: z.boolean(),
  /** Offer MCP servers from the user's Claude Code configuration alongside the extension's own. */
  user_mcp: z.boolean(),
});

export type ClaudePolicy = z.infer<typeof claudePolicySchema>;

function resolveTools(
  setting: ClaudeOverrides["tools"],
  readOnly: boolean,
): ClaudePolicy["tools"] {
  if (setting !== "profile") return setting;

  return readOnly ? "restricted" : "all";
}

/** Settings choose each restriction; "profile" restricts read-only profiles only. */
export function resolveClaudePolicy(
  overrides: ClaudeOverrides,
  workerProfile: string,
): ClaudePolicy {
  const readOnly = readOnlyProfile(workerProfile);

  return {
    sandbox: overrides.sandbox,
    tools: resolveTools(overrides.tools, readOnly),
    path_guard:
      overrides.path_guard === "profile"
        ? readOnly
        : overrides.path_guard === "on",
    subagents: overrides.subagents,
    settings_files: overrides.settings_files,
    user_mcp: overrides.user_mcp,
  };
}
