import type { ProviderTaskPolicy } from "../../src/service/features/providers/task-policy.js";
import { executionTaskPolicy } from "../../src/service/features/providers/task-policy.js";
import {
  exceedsPermission,
  resolveClaudePermission,
  resolveClaudePolicy,
} from "../../src/shared/providers/claude/permissions.js";
import {
  claudeStartOptionsSchema,
  claudeTaskOptionsSchema,
} from "../../src/shared/providers/claude/task-options.js";
import {
  optionsForProvider,
  withProviderOptions,
} from "../../src/shared/providers/options.js";
import type { Task } from "../../src/shared/tasks/model.js";

/** The fixture's options. Tests may start fixture tasks with partial state. */
export function readFixtureTaskOptions(task: Task) {
  return claudeTaskOptionsSchema
    .partial()
    .parse(optionsForProvider(task.provider_options, "fixture"));
}

export const fixtureTaskPolicy: ProviderTaskPolicy = {
  ...executionTaskPolicy,
  prepareStart(context) {
    const { input, defaults, authority } = context;

    const requested = claudeStartOptionsSchema.parse(
      optionsForProvider(input.provider_options, "fixture"),
    );

    // The fixture has no settings block of its own and reuses Claude's.
    const claude = defaults.providers.claude,
      baseline = resolveClaudePermission({}, claude.permission_mode),
      resolved = resolveClaudePermission(requested, claude.permission_mode);

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
      defaults.approvals.decider !== "parent_agent"
    ) {
      throw new Error(
        "Parent approval requires user authorization in settings",
      );
    }

    const execution = executionTaskPolicy.prepareStart({
      ...context,
      input: { ...input, provider_options: undefined },
    });

    const approval_decider =
      requested.approval_decider ?? defaults.approvals.decider;

    return {
      ...execution,
      provider_options: withProviderOptions(input.provider_options, "fixture", {
        ...requested,
        approval_decider,
        permission_mode: resolved.mode,
        permission_source: resolved.source,
        claude_policy: resolveClaudePolicy(claude, input.worker_profile),
      }),
    };
  },
  decideInput(task, tool) {
    if (tool === "AskUserQuestion") return undefined;

    const mode = readFixtureTaskOptions(task).permission_mode;

    if (mode === "plan" || mode === "dontAsk") return false;
    if (mode === "auto" || mode === "bypassPermissions") return true;

    if (
      mode === "acceptEdits" &&
      ["Edit", "Write", "NotebookEdit"].includes(tool)
    ) {
      return true;
    }

    return executionTaskPolicy.decideInput(task, tool);
  },
  parentMayApprove: (task) =>
    readFixtureTaskOptions(task).approval_decider === "parent_agent" ||
    executionTaskPolicy.parentMayApprove(task),
};
