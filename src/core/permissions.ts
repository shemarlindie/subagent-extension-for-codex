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
  inherit: "Inherit from parent or task",
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
export type ParentPermissions = {
  provider: "claude" | "codex";
  permission_mode?: ClaudePermissionMode;
  sandbox_mode?:
    "read-only" | "workspace-write" | "danger-full-access" | "external-sandbox";
  approval_policy?:
    | "untrusted"
    | "on-request"
    | "on-failure"
    | "never"
    | "auto-review"
    | "auto_review";
};
const parentSchema = z.object({
  provider: z.enum(["claude", "codex"]),
  permission_mode: z.enum(claudePermissionModes).optional(),
  sandbox_mode: z
    .enum([
      "read-only",
      "workspace-write",
      "danger-full-access",
      "external-sandbox",
    ])
    .optional(),
  approval_policy: z
    .enum([
      "untrusted",
      "on-request",
      "on-failure",
      "never",
      "auto-review",
      "auto_review",
    ])
    .optional(),
});
/** Host metadata is separate from model-visible task arguments. Unknown modes grant nothing. */
export function parentPermissionsFromMeta(
  meta?: Record<string, unknown>,
): ParentPermissions | undefined {
  const explicit = parentSchema.safeParse(
    meta?.["codex-subagent-extension/parent-permissions"],
  );
  const state = meta?.["codex/sandbox-state-meta"];
  if (!state || typeof state !== "object")
    return explicit.success ? explicit.data : undefined;
  const value = state as {
    sandboxPolicy?: { type?: unknown };
    approvalPolicy?: unknown;
  };
  // Parse each field separately so unfamiliar approval policies don't lose read-only context.
  const sandbox = parentSchema.shape.sandbox_mode.safeParse(
    value.sandboxPolicy?.type,
  );
  const approval = parentSchema.shape.approval_policy.safeParse(
    value.approvalPolicy,
  );
  const host: ParentPermissions | undefined =
    (sandbox.success && sandbox.data) || (approval.success && approval.data)
      ? {
          provider: "codex",
          sandbox_mode: sandbox.success ? sandbox.data : undefined,
          approval_policy: approval.success ? approval.data : undefined,
        }
      : undefined;
  if (!explicit.success) return host;
  const customMode = closestClaudeMode(explicit.data);
  const hostMode = closestClaudeMode(host);
  if (!customMode) return host ?? explicit.data;
  if (!hostMode) return explicit.data;
  // Custom delegation context cannot widen a stricter actual host mode.
  return {
    provider: "claude",
    permission_mode:
      permissionRank[hostMode] < permissionRank[customMode]
        ? hostMode
        : customMode,
  };
}
export const readOnlyProfile = (role: string) =>
  ["researcher", "reviewer", "security_reviewer"].includes(role);
export function closestClaudeMode(
  parent?: ParentPermissions,
): ClaudePermissionMode | undefined {
  if (!parent) return;
  if (parent.sandbox_mode === "read-only") return "plan";
  if (parent.provider === "claude") return parent.permission_mode;
  switch (parent.approval_policy) {
    case "never":
      return "bypassPermissions";
    case "auto-review":
    case "auto_review":
      return "auto";
    case "untrusted":
    case "on-failure":
      return "default";
    case "on-request":
      return parent.sandbox_mode === "workspace-write"
        ? "acceptEdits"
        : "default";
    default:
      return parent.sandbox_mode === "workspace-write"
        ? "acceptEdits"
        : undefined;
  }
}
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
  parent?: ParentPermissions,
) {
  if (input.permission_mode && input.permission_mode !== "inherit")
    return { mode: input.permission_mode, source: "task" as const };
  if (configured !== "inherit")
    return { mode: configured, source: "setting" as const };
  // Review profiles remain read-only even when a parent's mode permits mutation.
  const inherited = closestClaudeMode(parent);
  if (inherited)
    return {
      mode: readOnlyProfile(input.worker_profile)
        ? ("plan" as const)
        : inherited,
      source: "parent" as const,
    };
  return {
    mode: readOnlyProfile(input.worker_profile)
      ? ("plan" as const)
      : ("acceptEdits" as const),
    source: "task_profile" as const,
  };
}
