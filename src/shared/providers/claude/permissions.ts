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

export const approvalDeciderSchema = z.enum(["user", "parent_agent"]);

export type ApprovalDecider = z.infer<typeof approvalDeciderSchema>;

// Optional restrictions on delegated Claude sessions. "profile" applies the
// worker profile's bundle: read-only profiles restrict, write profiles don't.
export const claudeSandboxSchema = z.enum([
  "user_config",
  "extension",
  "extension_locked",
]);

export const claudeEnvironmentSchema = z.enum(["inherit", "filtered"]);
export const claudeToolsSchema = z.enum(["profile", "all", "restricted"]);
export const claudePathGuardSchema = z.enum(["profile", "on", "off"]);

export const claudeOverridesSchema = z.object({
  claude_sandbox: claudeSandboxSchema,
  claude_environment: claudeEnvironmentSchema,
  claude_tools: claudeToolsSchema,
  claude_path_guard: claudePathGuardSchema,
  claude_subagents: z.boolean(),
});

export type ClaudeOverrides = z.infer<typeof claudeOverridesSchema>;

// Other Claude Code configuration loads by default; the extension owns the
// session's native permission mode.
export const claudeOverrideDefaults: ClaudeOverrides = {
  claude_sandbox: "user_config",
  claude_environment: "inherit",
  claude_tools: "profile",
  claude_path_guard: "profile",
  claude_subagents: true,
};

export const claudeOverrideLabels: Record<string, Record<string, string>> = {
  claude_sandbox: {
    user_config: "Your Claude Code settings",
    extension: "Extension sandbox",
    extension_locked: "Extension sandbox with locked network",
  },
  claude_environment: {
    inherit: "Full environment",
    filtered: "Filtered allowlist",
  },
  claude_tools: {
    profile: "By worker profile",
    all: "All tools",
    restricted: "Restricted set",
  },
  claude_path_guard: {
    profile: "By worker profile",
    on: "On",
    off: "Off",
  },
};

export function approvalDecider(options: {
  approval_decider?: z.infer<typeof approvalDeciderSchema>;
}) {
  return options.approval_decider ?? "user";
}

export const permissionLabels: Partial<
  Record<ClaudePermissionMode | "inherit", string>
> = {
  inherit: "Use extension setting",
  default: "Default — ask for approval",
  acceptEdits: "Accept edits",
  plan: "Plan — read only",
  dontAsk: "Don't ask — deny unapproved actions",
  auto: "Auto — SDK approval classifier",
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
  environment: claudeEnvironmentSchema,
  tools: z.enum(["all", "restricted"]),
  path_guard: z.boolean(),
  subagents: z.boolean(),
});

export type ClaudePolicy = z.infer<typeof claudePolicySchema>;

function resolveTools(
  setting: ClaudeOverrides["claude_tools"],
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
    sandbox: overrides.claude_sandbox,
    environment: overrides.claude_environment,
    tools: resolveTools(overrides.claude_tools, readOnly),
    path_guard:
      overrides.claude_path_guard === "profile"
        ? readOnly
        : overrides.claude_path_guard === "on",
    subagents: overrides.claude_subagents,
  };
}
