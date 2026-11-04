import { providerMetadata } from "../../../shared/providers/metadata";
import type { Worker } from "../../app/state/types";
import { runsInPlace } from "../projects/selectors";
import type { ProjectGit } from "../projects/types";
import type { DelegateValues } from "./delegate-values";
import { workerChoice } from "./delegation";

/**
 * The `start_task` arguments for a new task's form values. A project with no
 * commit runs in place, whatever worktree default the form started from.
 */
export function startTaskArguments(
  values: DelegateValues,
  workers: Worker[],
  conversation: string | undefined,
  git?: ProjectGit,
) {
  const strategy = runsInPlace(git)
    ? "current_repo"
    : values.workspace_strategy;

  const { provider, profile: worker_profile } = workerChoice(values.worker);
  const worker = workers.find((item) => item.provider === provider);

  const permissions = providerMetadata(
    provider,
    worker?.metadata,
  )?.nativePermissions;

  const nativeOptions = permissions
    ? {
        [permissions.permissionOption]: values.permission_mode,
        ...(permissions.approvalDeciderOption
          ? { [permissions.approvalDeciderOption]: values.approval_decider }
          : {}),
      }
    : undefined;

  return {
    ...(nativeOptions
      ? { provider_options: { [provider]: nativeOptions } }
      : {}),
    repository: values.repository,
    description: values.description,
    provider,
    worker_profile,
    model: values.model,
    reasoning_effort: values.reasoning_effort,
    revision: strategy === "current_repo" ? "HEAD" : values.revision,
    workspace_strategy: strategy,
    conversation_id: conversation ?? null,
    context: values.context.trim() ? [values.context] : [],
    depends_on: values.deps,
    budget: {
      max_runtime_minutes:
        values.runtimeMode === "none" ? null : Number(values.runtime),
      max_cost_usd: values.costMode === "none" ? null : Number(values.cost),
    },
  };
}
