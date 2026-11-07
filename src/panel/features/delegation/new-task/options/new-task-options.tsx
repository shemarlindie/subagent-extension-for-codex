import { useEffect, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { modelAllowed } from "../../../../../shared/providers/policy";
import type {
  NewTaskState,
  Snapshot,
  Worker,
} from "../../../../app/state/types";
import { useAutoList } from "../../../../shared/components/motion/auto-list";
import type { DelegateValues } from "../../delegate-values";
import { modelDefaults } from "../../model-defaults";
import { compactReasoningLabel } from "../../setting-labels";
import { newTaskProjects, profileValues } from "../new-task-values";
import { ModelChip, modelChipLabel } from "./model-chip";
import { ProfileChip } from "./profile-chip";
import { ProfileSettingsToggle } from "./profile-settings-toggle";
import { ProjectChip } from "./project-chip";
import { ReasoningChip, reasoningChipLabel } from "./reasoning-chip";

type NewTaskOptionsProps = {
  newTask: NewTaskState;
  state: Snapshot;
};

type ResolvedOptions = ReturnType<typeof resolvedOptions>;

/** Why the model list is shorter than usual, if it is. */
function modelsFooter(workerInfo: Worker | undefined) {
  if (workerInfo?.model_discovery_error) {
    return "Couldn't load the model list. Use More options to enter a model ID.";
  }

  return workerInfo?.policy?.available_models
    ? "Your organization limits these models."
    : undefined;
}

/** What the selected worker resolves to, once settings have loaded. */
function resolvedOptions(
  newTask: NewTaskState,
  state: Snapshot,
  worker: string,
  model: string,
) {
  const resolved = newTask.defaults
    ? modelDefaults(newTask.defaults, state.workers, worker, model)
    : undefined;

  const { workerInfo, providerModel } = resolved ?? {},
    models = workerInfo?.models ?? [];

  return {
    models,
    modelExcluded: !modelAllowed(workerInfo?.policy, models, model),
    reasoning: resolved?.providerReasoning,
    supported: resolved?.supported ?? [],
    modelsFooter: modelsFooter(workerInfo),
    // The chips edit the profile's settings, so Default clears them and
    // inherits the provider's. A saved model policy excludes reads as none.
    model:
      providerModel && modelAllowed(workerInfo?.policy, models, providerModel)
        ? providerModel
        : undefined,
  };
}

/**
 * The model and reasoning in effect: abbreviated for the summary
 * (`Sonnet 5.5 · H`) and in full, as the chips read them, for its label.
 */
function settingsSummary(
  resolved: ResolvedOptions,
  [model = "", reasoning = "default"]: string[],
) {
  const modelLabel = modelChipLabel(resolved.models, model, resolved.model),
    supportsReasoning = resolved.supported.length > 0,
    reasoningShort = compactReasoningLabel(reasoning, resolved.reasoning),
    reasoningText = reasoningChipLabel(reasoning, resolved.reasoning),
    line = (parts: (string | false | undefined)[]) =>
      parts.filter(Boolean).join(" · ");

  return {
    summary: line([modelLabel, supportsReasoning && reasoningShort]),
    description: line([
      modelLabel,
      supportsReasoning &&
        (reasoningShort ? `${reasoningText} reasoning` : reasoningText),
    ]),
  };
}

/**
 * The composer's options. The profile leads; the model and reasoning it sets
 * collapse into a summary that expands for editing. More options sets the
 * permission mode and sandbox.
 */
export function NewTaskOptions({ newTask, state }: NewTaskOptionsProps) {
  const { control, getValues, setValue } = useFormContext<DelegateValues>(),
    values = useWatch({
      control,
      name: ["worker", "model", "reasoning_effort"],
    }),
    [worker, model] = values,
    // A draft that already overrides the profile opens with its settings shown.
    // Reasoning stays blank until settings load.
    [expanded, setExpanded] = useState(() => {
      const saved = profileValues(getValues("worker"), newTask.defaults);

      return (
        getValues("model") !== saved.model ||
        !["", saved.reasoning_effort].includes(getValues("reasoning_effort"))
      );
    }),
    [optionsRef] = useAutoList<HTMLDivElement>(),
    { statuses } = newTask,
    loading = statuses.workers === "loading" || statuses.settings === "loading",
    disabled =
      state.busy ||
      statuses.settings !== "ready" ||
      statuses.workers !== "ready",
    resolved = resolvedOptions(newTask, state, worker, model),
    { modelExcluded } = resolved;

  // A saved model policy excludes shows as what will run. Sent blank, the
  // service falls back from it and says so in Chat.
  useEffect(() => {
    if (!modelExcluded) return;
    setValue("model", "");
    setValue("reasoning_effort", "default");
  }, [modelExcluded, setValue]);

  return (
    <div
      ref={optionsRef}
      className="new-task-options"
      data-expanded={expanded}
      role="group"
      aria-label="Task options"
    >
      {!state.repository && (
        <ProjectChip
          projects={newTaskProjects(state)}
          added={newTask.addedProject}
          loading={
            statuses.projects === "loading" || statuses.context === "loading"
          }
          disabled={state.busy || statuses.projects !== "ready"}
        />
      )}
      <ProfileChip
        workers={state.workers}
        defaults={newTask.defaults}
        loading={loading && !worker}
        disabled={disabled}
      />
      {/* Direct children keep their own boxes for list motion and chip wrapping. */}
      {expanded && (
        <>
          <ModelChip
            models={resolved.models}
            inherited={resolved.model}
            footer={resolved.modelsFooter}
            loading={loading}
            disabled={disabled}
          />
          <ReasoningChip
            supported={resolved.supported}
            inherited={resolved.reasoning}
            loading={loading}
            disabled={disabled}
          />
        </>
      )}
      <ProfileSettingsToggle
        controls={["new-task-model", "new-task-reasoning"]
          .filter(Boolean)
          .join(" ")}
        expanded={expanded}
        {...settingsSummary(resolved, values.slice(1))}
        loading={loading}
        onToggle={() => setExpanded(!expanded)}
      />
    </div>
  );
}
