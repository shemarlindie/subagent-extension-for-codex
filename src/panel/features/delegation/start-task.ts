import { providerMetadata } from "../../../shared/providers/metadata";
import type { Worker } from "../../app/state/types";
import type { DelegateValues } from "./delegate-values";
import { workerChoice } from "./delegation";

/** The `start_agent_task` arguments for a new task's form values. */
export function startTaskArguments(
  values: DelegateValues,
  workers: Worker[],
  conversation: string | undefined,
) {
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
    revision:
      values.workspace_strategy === "current_repo" ? "HEAD" : values.revision,
    workspace_strategy: values.workspace_strategy,
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
