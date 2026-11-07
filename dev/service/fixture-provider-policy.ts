import { claudeStartOptions } from "../../src/service/features/providers/claude/configuration/task-policy.js";
import type { ProviderTaskPolicy } from "../../src/service/features/providers/task-policy.js";
import { executionTaskPolicy } from "../../src/service/features/providers/task-policy.js";
import { claudeTaskOptionsSchema } from "../../src/shared/providers/claude/task-options.js";
import { optionsForProvider } from "../../src/shared/providers/options.js";
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
    const { input } = context;

    // The fixture has no settings block of its own and reuses Claude's.
    const provider_options = claudeStartOptions(context, "fixture");

    const execution = executionTaskPolicy.prepareStart({
      ...context,
      input: { ...input, provider_options: undefined },
    });

    return { ...execution, provider_options };
  },
  decideInput(task, tool) {
    if (tool === "AskUserQuestion") return undefined;

    const mode = readFixtureTaskOptions(task).permission_mode;

    // Plan mode asks before edits, as Claude Code does.
    if (mode === "dontAsk") return false;
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
