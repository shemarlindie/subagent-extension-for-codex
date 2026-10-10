import { z } from "zod";

export const claudePermissionModes = [
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "auto",
  "bypassPermissions",
] as const;

export type ClaudePermissionMode = (typeof claudePermissionModes)[number];

/** Modes the extension stores and always passes to the Claude SDK. */
export const claudePermissionSettingSchema = z.enum(claudePermissionModes);

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
  input: { permission_mode?: z.infer<typeof permissionModeSchema> },
  configured: z.infer<typeof permissionModeSchema>,
) {
  if (input.permission_mode && input.permission_mode !== "inherit")
    return { mode: input.permission_mode, source: "task" as const };

  // Older saved extension settings used `inherit` to defer the mode to Claude
  // Code. Keep reading that sentinel, but resolve it to the new safe default.
  return {
    mode: configured === "inherit" ? ("default" as const) : configured,
    source: "setting" as const,
  };
}

/** Whether a model-selected mode could allow more than the user-approved baseline. */
export function exceedsPermission(
  requested: z.infer<typeof permissionModeSchema>,
  baseline: z.infer<typeof permissionModeSchema>,
) {
  if (requested === baseline) return false;
  if (requested === "inherit") return true;
  // Treat legacy inherited baselines conservatively when comparing overrides.
  if (baseline === "inherit")
    return (
      permissionRank[requested] === undefined ||
      permissionRank[requested]! > permissionRank.dontAsk!
    );

  const requestedRank = permissionRank[requested],
    baselineRank = permissionRank[baseline];

  // An SDK mode without an explicit rank has unknown policy; fail closed when
  // comparing it with a different mode until its behavior is reviewed.
  if (requestedRank === undefined || baselineRank === undefined) return true;

  return requestedRank > baselineRank;
}

/** Resolve legacy or missing task modes to the explicit extension default. */
export function taskClaudeMode(options: {
  permission_mode?: z.infer<typeof permissionModeSchema>;
}): ClaudePermissionMode {
  return !options.permission_mode || options.permission_mode === "inherit"
    ? "default"
    : options.permission_mode;
}

export const claudePolicySchema = z.object({
  sandbox: claudeSandboxSchema,
  environment: claudeEnvironmentSchema,
  tools: z.enum(["all", "restricted"]),
  path_guard: z.boolean(),
  subagents: z.boolean(),
});

export type ClaudePolicy = z.infer<typeof claudePolicySchema>;

/** Settings choose each restriction; "profile" restricts read-only profiles only. */
export function resolveClaudePolicy(
  overrides: ClaudeOverrides,
  workerProfile: string,
): ClaudePolicy {
  const readOnly = readOnlyProfile(workerProfile);

  return {
    sandbox: overrides.claude_sandbox,
    environment: overrides.claude_environment,
    tools:
      overrides.claude_tools === "profile"
        ? readOnly
          ? "restricted"
          : "all"
        : overrides.claude_tools,
    path_guard:
      overrides.claude_path_guard === "profile"
        ? readOnly
        : overrides.claude_path_guard === "on",
    subagents: overrides.claude_subagents,
  };
}
