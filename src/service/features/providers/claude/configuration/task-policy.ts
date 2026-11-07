import { access } from "node:fs/promises";

import {
  exceedsPermission,
  resolveClaudePermission,
  resolveClaudePolicy,
} from "../../../../../shared/providers/claude/permissions.js";
import {
  claudeStartOptionsSchema,
  readClaudeTaskOptions,
} from "../../../../../shared/providers/claude/task-options.js";
import {
  optionsForProvider,
  withProviderOptions,
} from "../../../../../shared/providers/options.js";
import type { ProviderTaskPolicy } from "../../task-policy.js";

type TaskPreparation = Parameters<ProviderTaskPolicy["prepareStart"]>[0];

/**
 * The Claude options a task stores, from the options it asks for under
 * `provider`. Only the user can raise its mode or parent approval beyond the
 * settings, or turn off a sandbox the settings turn on.
 */
export function claudeStartOptions(
  { input, defaults, authority }: TaskPreparation,
  provider: string,
) {
  const { sandbox, ...requested } = claudeStartOptionsSchema.parse(
    optionsForProvider(input.provider_options, provider),
  );

  const claude = defaults.providers.claude,
    resolved = resolveClaudePermission(
      requested,
      claude.permission_mode,
      input.worker_profile,
    );

  if (authority !== "user") {
    if (exceedsPermission(resolved.mode, claude.permission_mode)) {
      throw new Error(
        "Task permission mode exceeds the user-approved native mode",
      );
    }

    if (
      requested.approval_decider === "parent_agent" &&
      defaults.approvals.decider !== "parent_agent"
    ) {
      throw new Error(
        "Parent approval requires user authorization in settings",
      );
    }

    if (sandbox === false && claude.sandbox) {
      throw new Error("Only the user can turn off the sandbox");
    }
  }

  return withProviderOptions(input.provider_options, provider, {
    ...requested,
    approval_decider: requested.approval_decider ?? defaults.approvals.decider,
    permission_mode: resolved.mode,
    permission_source: resolved.source,
    claude_policy: resolveClaudePolicy(claude, sandbox),
  });
}

export const claudeTaskPolicy: ProviderTaskPolicy = {
  inputKind: (tool) => (tool === "AskUserQuestion" ? "question" : "permission"),
  prepareStart(context) {
    const { input } = context;

    if (input.approval_mode !== undefined) {
      throw new Error(
        "Claude uses permission_mode and approval_decider; approval_mode is only supported by execution-approval providers",
      );
    }

    if (
      input.reasoning_effort &&
      ["none", "minimal"].includes(input.reasoning_effort)
    ) {
      throw new Error(
        "Claude reasoning must be low, medium, high, xhigh or max",
      );
    }

    return { provider_options: claudeStartOptions(context, "claude") };
  },
  // Claude's SDK applies the native mode before forwarding unresolved requests.
  decideInput: () => undefined,
  parentMayApprove: (task) =>
    readClaudeTaskOptions(task).approval_decider === "parent_agent",
  async validateSession(task) {
    if (task.session_state_ref) await access(task.session_state_ref);
  },
};
