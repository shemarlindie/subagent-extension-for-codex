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

export const claudeTaskPolicy: ProviderTaskPolicy = {
  inputKind: (tool) => (tool === "AskUserQuestion" ? "question" : "permission"),
  prepareStart({ input, defaults, authority }) {
    if (input.approval_mode !== undefined) {
      throw new Error(
        "Claude uses permission_mode and approval_decider; approval_mode is only supported by execution-approval providers",
      );
    }

    const requested = claudeStartOptionsSchema.parse(
      optionsForProvider(input.provider_options, "claude"),
    );

    const baseline = resolveClaudePermission(
      {},
      defaults.claude_permission_mode,
    );

    const resolved = resolveClaudePermission(
      requested,
      defaults.claude_permission_mode,
    );

    if (
      authority !== "user" &&
      exceedsPermission(resolved.mode, baseline.mode)
    ) {
      throw new Error(
        "Task permission mode exceeds the user-approved native mode",
      );
    }

    if (
      authority !== "user" &&
      requested.approval_decider === "parent_agent" &&
      defaults.default_approval_decider !== "parent_agent"
    ) {
      throw new Error(
        "Parent approval requires user authorization in settings",
      );
    }

    if (
      input.reasoning_effort &&
      ["none", "minimal"].includes(input.reasoning_effort)
    ) {
      throw new Error(
        "Claude reasoning effort must be low, medium, high, xhigh or max",
      );
    }

    return {
      provider_options: withProviderOptions(input.provider_options, "claude", {
        ...requested,
        approval_decider:
          requested.approval_decider ?? defaults.default_approval_decider,
        permission_mode: resolved.mode,
        permission_source: resolved.source,
        claude_policy: resolveClaudePolicy(defaults, input.worker_profile),
      }),
    };
  },
  // Claude's SDK applies the native mode before forwarding unresolved requests.
  decideInput: () => undefined,
  parentMayApprove: (task) =>
    readClaudeTaskOptions(task).approval_decider === "parent_agent",
  async validateSession(task) {
    if (task.session_state_ref) await access(task.session_state_ref);
  },
};
