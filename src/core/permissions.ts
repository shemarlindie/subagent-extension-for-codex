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
export const permissionModeSchema = z.enum([
  "inherit",
  ...claudePermissionModes,
]);
export const approvalDeciderSchema = z.enum(["user", "parent_agent"]);
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
// Delegated sessions behave like the user's own Claude Code CLI by default.
export const claudeOverrideDefaults: ClaudeOverrides = {
  claude_sandbox: "user_config",
  claude_environment: "inherit",
  claude_tools: "profile",
  claude_path_guard: "profile",
  claude_subagents: true,
};
export const claudeOverrideLabels: Record<string, Record<string, string>> = {
  claude_sandbox: {
    user_config: "Your Claude settings",
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
// Persisted tasks can predate the separate decision-maker field.
export function approvalDecider(task: {
  approval_decider?: z.infer<typeof approvalDeciderSchema>;
  approval_mode?: string;
}) {
  return (
    task.approval_decider ??
    (task.approval_mode === "parent_agent" ? "parent_agent" : "user")
  );
}
export const permissionLabels = {
  inherit: "Your Claude Code settings",
  default: "Default — ask for approval",
  acceptEdits: "Accept edits",
  plan: "Plan — read only",
  dontAsk: "Don't ask — deny unapproved actions",
  auto: "Auto — SDK approval classifier",
  bypassPermissions: "Bypass permission prompts",
} as const;
export const permissionRank: Record<ClaudePermissionMode, number> = {
  plan: 0,
  dontAsk: 1,
  default: 2,
  acceptEdits: 3,
  auto: 4,
  bypassPermissions: 5,
};
export const readOnlyProfile = (role: string) =>
  ["researcher", "reviewer", "security_reviewer"].includes(role);
export function legacyClaudeMode(
  mode?: string,
): ClaudePermissionMode | undefined {
  switch (mode) {
    case "ask_user":
    case "parent_agent":
      return "default";
    case "auto_approve":
      return "bypassPermissions";
    case "deny":
      return "dontAsk";
  }
}
export function resolveClaudePermission(
  input: {
    permission_mode?: z.infer<typeof permissionModeSchema>;
    worker_profile: string;
  },
  configured: z.infer<typeof permissionModeSchema>,
) {
  if (input.permission_mode && input.permission_mode !== "inherit")
    return { mode: input.permission_mode, source: "task" as const };
  if (configured !== "inherit")
    return { mode: configured, source: "setting" as const };
  // Review profiles stay read-only unless a task or setting chooses a mode.
  if (readOnlyProfile(input.worker_profile))
    return { mode: "plan" as const, source: "task_profile" as const };
  return { mode: "inherit" as const, source: "user_config" as const };
}
/** Whether a model-selected mode could allow more than the user-approved baseline. "inherit" defers to Claude settings, so its authority is unknown. */
export function exceedsPermission(
  requested: z.infer<typeof permissionModeSchema>,
  baseline: z.infer<typeof permissionModeSchema>,
) {
  if (requested === baseline) return false;
  if (requested === "inherit") return true;
  // Under unknown settings, only modes that never approve beyond settings rules are safe.
  if (baseline === "inherit")
    return permissionRank[requested] > permissionRank.dontAsk;
  return permissionRank[requested] > permissionRank[baseline];
}
/** The native mode a stored task runs with; undefined leaves it to the user's Claude settings. */
export function taskClaudeMode(task: {
  permission_mode?: z.infer<typeof permissionModeSchema>;
  approval_mode?: string;
  worker_profile: string;
}): ClaudePermissionMode | undefined {
  if (task.permission_mode && task.permission_mode !== "inherit")
    return task.permission_mode;
  // Tasks stored before native modes keep their legacy policy.
  return (
    legacyClaudeMode(task.approval_mode) ??
    (readOnlyProfile(task.worker_profile) ? "plan" : undefined)
  );
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
