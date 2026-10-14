import { useFormContext, useWatch } from "react-hook-form";

import { readOnlyProfile } from "../../../../../shared/providers/claude/permissions";
import { providerMetadata } from "../../../../../shared/providers/metadata";
import type { NewTaskState, Snapshot } from "../../../../app/state/types";
import type { DelegateValues } from "../../delegate-values";
import { workerChoice } from "../../delegation";
import { modelDefaults } from "../../model-defaults";
import { newTaskProjects } from "../new-task-values";
import { ModelChip } from "./model-chip";
import { PermissionChip } from "./permission-chip";
import { ProfileChip } from "./profile-chip";
import { ProjectChip } from "./project-chip";
import { ReasoningChip } from "./reasoning-chip";

type NewTaskOptionsProps = {
  newTask: NewTaskState;
  state: Snapshot;
};

/** What the selected worker resolves to, once settings have loaded. */
function resolvedOptions(
  newTask: NewTaskState,
  state: Snapshot,
  worker: string,
  model: string,
) {
  const { provider, profile } = workerChoice(worker),
    resolved = newTask.defaults
      ? modelDefaults(newTask.defaults, state.workers, worker, model)
      : undefined;

  return {
    models: resolved?.workerInfo?.models ?? [],
    model: resolved?.model,
    reasoning: resolved?.reasoning,
    supported: resolved?.supported ?? [],
    permissions: providerMetadata(provider, resolved?.workerInfo?.metadata)
      ?.nativePermissions?.options,
    readOnly: Boolean(profile && readOnlyProfile(profile)),
  };
}

/** The composer's option chips: project, profile, model, reasoning and permission. */
export function NewTaskOptions({ newTask, state }: NewTaskOptionsProps) {
  const { control } = useFormContext<DelegateValues>(),
    [worker, model] = useWatch({ control, name: ["worker", "model"] }),
    { statuses } = newTask,
    loading = statuses.workers === "loading" || statuses.settings === "loading",
    disabled =
      state.busy ||
      statuses.settings !== "ready" ||
      statuses.workers !== "ready",
    resolved = resolvedOptions(newTask, state, worker, model);

  return (
    <div className="new-task-options" role="group" aria-label="Task options">
      {!state.repository && (
        <ProjectChip
          projects={newTaskProjects(state)}
          loading={
            statuses.projects === "loading" || statuses.context === "loading"
          }
          disabled={state.busy || statuses.projects !== "ready"}
        />
      )}
      <ProfileChip
        workers={state.workers}
        loading={loading && !worker}
        disabled={disabled}
      />
      <ModelChip
        models={resolved.models}
        inherited={resolved.model}
        loading={loading}
        disabled={disabled}
      />
      <ReasoningChip
        supported={resolved.supported}
        inherited={resolved.reasoning}
        loading={loading}
        disabled={disabled}
      />
      <PermissionChip
        options={resolved.permissions}
        readOnly={resolved.readOnly}
        loading={loading}
        disabled={disabled}
      />
    </div>
  );
}
