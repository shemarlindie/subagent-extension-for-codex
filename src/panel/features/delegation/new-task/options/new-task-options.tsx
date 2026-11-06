import { useEffect, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { readOnlyProfile } from "../../../../../shared/providers/claude/permissions";
import { providerMetadata } from "../../../../../shared/providers/metadata";
import {
  allowedPermissionMode,
  modelAllowed,
  withBlockedOptions,
} from "../../../../../shared/providers/policy";
import type { ModelChoice } from "../../../../../shared/providers/types";
import type {
  NewTaskState,
  Snapshot,
  Worker,
} from "../../../../app/state/types";
import { useAutoList } from "../../../../shared/components/motion/auto-list";
import type { DelegateValues } from "../../delegate-values";
import { workerChoice } from "../../delegation";
import { modelDefaults } from "../../model-defaults";
import { compactPermissionLabel } from "../../permission-label";
import { compactReasoningLabel } from "../../setting-labels";
import { newTaskProjects, profileValues } from "../new-task-values";
import { ModelChip, modelChipLabel } from "./model-chip";
import { PermissionChip, permissionChipLabel } from "./permission-chip";
import { ProfileChip } from "./profile-chip";
import { ProfileSettingsToggle } from "./profile-settings-toggle";
import { ProjectChip } from "./project-chip";
import { ReasoningChip, reasoningChipLabel } from "./reasoning-chip";

type NewTaskOptionsProps = {
  newTask: NewTaskState;
  state: Snapshot;
};

type ResolvedOptions = ReturnType<typeof resolvedOptions>;

/** The choices org policy changes: locked modes, and a saved model it excludes. */
function policyOptions(
  provider: string,
  workerInfo: Worker | undefined,
  models: ModelChoice[],
  model: string | undefined,
) {
  const policy = workerInfo?.policy,
    permissions = providerMetadata(provider, workerInfo?.metadata)
      ?.nativePermissions?.options;

  return {
    model: model && modelAllowed(policy, models, model) ? model : undefined,
    modelsFooter: policy?.available_models
      ? "Your organization limits these models."
      : undefined,
    permissions:
      permissions && withBlockedOptions(permissions, policy, "permission_mode"),
  };
}

/** What the selected worker resolves to, once settings have loaded. */
function resolvedOptions(
  newTask: NewTaskState,
  state: Snapshot,
  worker: string,
  model: string,
  mode: string,
) {
  const { provider, profile } = workerChoice(worker),
    resolved = newTask.defaults
      ? modelDefaults(newTask.defaults, state.workers, worker, model)
      : undefined;

  const { workerInfo, providerModel } = resolved ?? {},
    models = workerInfo?.models ?? [];

  return {
    models,
    modelExcluded: !modelAllowed(workerInfo?.policy, models, model),
    allowedMode: allowedPermissionMode(workerInfo?.policy, mode),
    reasoning: resolved?.providerReasoning,
    supported: resolved?.supported ?? [],
    // The chips edit the profile's settings, so Default clears them and
    // inherits the provider's.
    ...policyOptions(provider, workerInfo, models, providerModel),
    readOnly: Boolean(profile && readOnlyProfile(profile)),
  };
}

/**
 * The model, reasoning and permission in effect: abbreviated for the
 * summary (`Sonnet 5.5 · H · Ask`) and in full, as the chips read them, for
 * its label.
 */
function settingsSummary(
  resolved: ResolvedOptions,
  [model = "", reasoning = "default", permission = ""]: string[],
) {
  const modelLabel = modelChipLabel(resolved.models, model, resolved.model),
    supportsReasoning = resolved.supported.length > 0,
    reasoningShort = compactReasoningLabel(reasoning, resolved.reasoning),
    reasoningText = reasoningChipLabel(reasoning, resolved.reasoning),
    permissionText = permissionChipLabel(
      resolved.permissions,
      permission,
      resolved.readOnly,
    ),
    line = (parts: (string | false | undefined)[]) =>
      parts.filter(Boolean).join(" · ");

  return {
    summary: line([
      modelLabel,
      supportsReasoning && reasoningShort,
      permissionText && compactPermissionLabel(permissionText),
    ]),
    description: line([
      modelLabel,
      supportsReasoning &&
        (reasoningShort ? `${reasoningText} reasoning` : reasoningText),
      permissionText,
    ]),
  };
}

/**
 * The composer's options. The profile leads; the model, reasoning and
 * permission it sets collapse into a summary that expands for editing.
 */
export function NewTaskOptions({ newTask, state }: NewTaskOptionsProps) {
  const { control, getValues, setValue } = useFormContext<DelegateValues>(),
    values = useWatch({
      control,
      name: ["worker", "model", "reasoning_effort", "permission_mode"],
    }),
    [worker, model, , mode] = values,
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
    resolved = resolvedOptions(newTask, state, worker, model, mode),
    { modelExcluded, allowedMode } = resolved;

  // A saved model policy excludes shows as what will run. Sent blank, the
  // service falls back from it and says so in Chat.
  useEffect(() => {
    if (!modelExcluded) return;
    setValue("model", "");
    setValue("reasoning_effort", "default");
  }, [modelExcluded, setValue]);

  // A restored draft or late policy can leave a blocked mode, which won't run.
  useEffect(() => {
    if (allowedMode !== mode) setValue("permission_mode", allowedMode);
  }, [allowedMode, mode, setValue]);

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
          <PermissionChip
            options={resolved.permissions}
            readOnly={resolved.readOnly}
            loading={loading}
            disabled={disabled}
          />
        </>
      )}
      <ProfileSettingsToggle
        controls={[
          "new-task-model",
          "new-task-reasoning",
          (resolved.permissions || loading) && "new-task-permission",
        ]
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
