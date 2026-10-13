import { Controller, useFormContext, useWatch } from "react-hook-form";

import { providerMetadata } from "../../../shared/providers/metadata";
import { reasoningLevels } from "../../../shared/tasks/reasoning";
import { profileLabel } from "../../app/state/selectors";
import type { Defaults, Project, Task, Worker } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/motion";
import { AsyncControl } from "../../shared/forms/async-control";
import { Field } from "../../shared/forms/fields";
import { FormFieldError } from "../../shared/forms/form-field-error";
import { FormFieldHint } from "../../shared/forms/form-field-hint";
import { FormSelect } from "../../shared/forms/form-select";
import { FormSwitch } from "../../shared/forms/form-switch";
import { projectDisplayName } from "../projects/selectors";
import { workerChoice } from "./delegation";
import { ModelAutocomplete } from "./model-autocomplete";
import { ProjectAutocomplete } from "./project-autocomplete";

export type DelegateValues = {
  permission_mode: string;
  approval_decider: string;
  repository: string;
  description: string;
  worker: string;
  model: string;
  reasoning_effort: string;
  revision: string;
  workspace_strategy: "" | "worktree" | "current_repo";
  context: string;
  runtimeMode: string;
  runtime: number | "";
  costMode: string;
  cost: number | "";
  deps: string[];
};

/** Placeholder for a select whose value is still waiting on settings or workers. */
function pendingPlaceholder(loading: boolean) {
  return loading ? "Loading…" : "Unavailable";
}

interface ProjectFieldProps {
  projects: Project[];
  allowParent: boolean;
  loading?: boolean;
  contextLoading?: boolean;
  error?: string;
  contextError?: string;
  disabled?: boolean;
  browseDisabled?: boolean;
  onBrowse?: () => void;
}

export function ProjectField({
  projects,
  allowParent,
  loading = false,
  contextLoading = false,
  error,
  contextError,
  disabled = false,
  browseDisabled = disabled,
  onBrowse,
}: ProjectFieldProps) {
  const { control } = useFormContext<DelegateValues>(),
    options = projects.filter((project) => project.kind === "repository");

  return (
    <Field id="repository" label="Project">
      <div className="project-selection">
        <div className="project-selection-control">
          {allowParent ? (
            <AsyncControl
              loading={loading || contextLoading}
              label={
                loading
                  ? "Loading approved projects"
                  : "Resolving project context"
              }
            >
              <ProjectAutocomplete
                disabled={disabled || loading || contextLoading}
                projects={options}
              />
            </AsyncControl>
          ) : (
            <FormSelect
              searchable
              control={control}
              name="repository"
              id="repository"
              label="Project"
              required
              disabled={disabled || loading || contextLoading}
              loading={loading || contextLoading}
              loadingLabel={
                loading
                  ? "Loading approved projects"
                  : "Resolving project context"
              }
              placeholder="Choose a project"
              rules={{
                required: "Choose a project before starting a task.",
              }}
              options={options.map((project) => ({
                value: project.repository,
                label: projectDisplayName(project),
                description: project.pending
                  ? `${project.repository} · Chat project, added when the task starts`
                  : project.repository,
                showDescriptionInValue: true,
              }))}
            />
          )}
        </div>
        {onBrowse && (
          <Button
            disabled={browseDisabled}
            onClick={onBrowse}
            title="Choose and add a repository on the service host"
          >
            Browse…
          </Button>
        )}
      </div>
      <FormFieldError message={error} />
      <FormFieldError
        message={
          contextError
            ? `Project context could not be resolved: ${contextError}`
            : undefined
        }
      />
      <FormFieldHint
        message={
          !loading &&
          !contextLoading &&
          !error &&
          !options.length &&
          !allowParent
            ? "Add a project before starting a task."
            : undefined
        }
      />
      {allowParent && (
        <p className="help">
          Use a registered Git root or a Git repository inside an approved
          parent.
        </p>
      )}
    </Field>
  );
}

export function WorkspaceField({
  settingsReady = true,
  settingsLoading = false,
}: {
  settingsReady?: boolean;
  settingsLoading?: boolean;
}) {
  const { control } = useFormContext<DelegateValues>();
  const value = useWatch({ control, name: "workspace_strategy" });
  const unresolved = !settingsReady && !value;

  return (
    <Field id="workspace-strategy" label="Workspace">
      <FormSelect
        control={control}
        name="workspace_strategy"
        id="workspace-strategy"
        label="Workspace"
        disabled={!settingsReady}
        loading={settingsLoading && unresolved}
        loadingLabel="Loading workspace default"
        placeholder={
          unresolved ? pendingPlaceholder(settingsLoading) : undefined
        }
        options={[
          { value: "worktree", label: "Isolated worktree" },
          {
            value: "current_repo",
            label: "Current repository (uncommitted changes)",
          },
        ]}
      />
    </Field>
  );
}

export function WorkerFields({
  workers,
  loading = false,
  error,
  disabled = false,
  revisionDisabled = false,
  revisionLoading = false,
}: {
  workers: Worker[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  revisionDisabled?: boolean;
  revisionLoading?: boolean;
}) {
  const { register, control } = useFormContext<DelegateValues>();
  const strategy = useWatch({ control, name: "workspace_strategy" });
  const selected = useWatch({ control, name: "worker" });
  const revision = useWatch({ control, name: "revision" });

  const readiness = workers.find(
    (worker) => worker.provider === workerChoice(selected).provider,
  )?.readiness;

  return (
    <div className="two">
      <div>
        <Field id="worker" label="Worker">
          <FormSelect
            control={control}
            name="worker"
            id="worker"
            label="Worker"
            disabled={
              disabled ||
              loading ||
              !workers.some((worker) => worker.profiles.length)
            }
            loading={loading}
            loadingLabel="Loading available workers"
            placeholder={!selected ? pendingPlaceholder(loading) : undefined}
            options={workers.flatMap((worker) =>
              worker.profiles.map((profile) => ({
                value: `${worker.provider}:${profile}`,
                label: `${worker.provider} · ${profileLabel(profile)}`,
              })),
            )}
          />
          <FormFieldError message={error} />
          <FormFieldError
            message={
              !loading &&
              !error &&
              !workers.some((worker) => worker.profiles.length)
                ? "No workers are available. Check service configuration in Codex."
                : undefined
            }
          />
          <FormFieldError
            id="worker-error"
            message={readiness?.ready === false ? readiness.message : undefined}
          />
        </Field>
      </div>
      <div>
        <Field id="revision" label="Revision">
          <AsyncControl
            loading={revisionLoading && !revision}
            label="Resolving repository revision"
          >
            <input
              id="revision"
              disabled={revisionDisabled}
              placeholder={
                revisionLoading && !revision ? "Loading…" : undefined
              }
              readOnly={strategy === "current_repo"}
              required
              {...register("revision", { required: true })}
            />
          </AsyncControl>
        </Field>
      </div>
    </div>
  );
}

/** Explains the cost limit for the selected worker, when there is something to explain. */
function costNote(
  provider: Worker | undefined,
  workerResolved: boolean,
  workersReady: boolean,
  mode: string,
) {
  if (!workerResolved) {
    return workersReady
      ? "Choose a worker to see budget support."
      : "Loading budget options.";
  }

  if (mode === "none") return undefined;

  const costBudgetHelp = providerMetadata(
    provider?.provider ?? "",
    provider?.metadata,
  )?.costBudgetHelp;

  if (costBudgetHelp) return costBudgetHelp;

  return provider?.capabilities.cost_budget
    ? undefined
    : "This provider requires No cost limit.";
}

export function BudgetFields({
  workers,
  settingsReady = true,
  workersReady = true,
  settingsLoading = false,
}: {
  workers: Worker[];
  settingsReady?: boolean;
  workersReady?: boolean;
  settingsLoading?: boolean;
}) {
  const {
      register,
      control,
      formState: { errors },
    } = useFormContext<DelegateValues>(),
    [worker, mode, runtimeMode, cost, runtime] = useWatch({
      control,
      name: ["worker", "costMode", "runtimeMode", "cost", "runtime"],
    });

  const provider = workers.find(
    (item) => item.provider === workerChoice(worker).provider,
  );

  const workerResolved = Boolean(worker && provider);

  return (
    <>
      <div className="setting-row setting-row-inline">
        <span id="cost-mode-label" className="setting-label">
          Cost limit
        </span>
        <div className="setting-control">
          <span
            className="setting-amount"
            data-off={mode !== "limited" || undefined}
          >
            <AsyncControl
              loading={settingsLoading && cost === "" && mode !== "none"}
              label="Loading cost budget defaults"
            >
              <input
                id="cost"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                disabled={mode !== "limited" || !settingsReady || !workersReady}
                required={mode === "limited"}
                aria-label="Cost limit (USD)"
                aria-describedby="cost-note budget-error"
                {...register("cost", {
                  valueAsNumber: true,
                  validate: (value) =>
                    mode === "none" ||
                    (typeof value === "number" &&
                      Number.isFinite(value) &&
                      value > 0) ||
                    "Cost budget must be greater than zero.",
                })}
              />
            </AsyncControl>
            <span className="setting-unit">USD</span>
          </span>
          <Controller
            control={control}
            name="costMode"
            rules={{
              validate: (value) =>
                value === "none" ||
                Boolean(provider?.capabilities.cost_budget) ||
                "This worker cannot enforce a cost budget. Choose No cost limit.",
            }}
            render={({ field }) => (
              <FormSwitch
                checked={field.value === "limited"}
                onCheckedChange={(checked) =>
                  field.onChange(checked ? "limited" : "none")
                }
                onBlur={field.onBlur}
                id="cost-mode"
                labelId="cost-mode-label"
                describedBy="cost-note budget-error"
                disabled={!settingsReady || !workersReady}
                loading={settingsLoading && !field.value}
              />
            )}
          />
        </div>
      </div>
      <p id="cost-note" className="help">
        {costNote(provider, workerResolved, workersReady, mode)}
      </p>
      <div className="setting-row setting-row-inline">
        <span id="runtime-mode-label" className="setting-label">
          Runtime limit
        </span>
        <div className="setting-control">
          <span
            className="setting-amount"
            data-off={runtimeMode !== "limited" || undefined}
          >
            <AsyncControl
              loading={
                settingsLoading && runtime === "" && runtimeMode !== "none"
              }
              label="Loading runtime limit defaults"
            >
              <input
                id="runtime"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                disabled={runtimeMode !== "limited" || !settingsReady}
                required={runtimeMode === "limited"}
                aria-label="Runtime limit (mins)"
                aria-describedby="budget-error"
                {...register("runtime", {
                  valueAsNumber: true,
                  validate: (value) =>
                    runtimeMode === "none" ||
                    (typeof value === "number" &&
                      Number.isFinite(value) &&
                      value > 0) ||
                    "Runtime limit must be greater than zero.",
                })}
              />
            </AsyncControl>
            <span className="setting-unit">mins</span>
          </span>
          <Controller
            control={control}
            name="runtimeMode"
            render={({ field }) => (
              <FormSwitch
                checked={field.value === "limited"}
                onCheckedChange={(checked) =>
                  field.onChange(checked ? "limited" : "none")
                }
                onBlur={field.onBlur}
                id="runtime-mode"
                labelId="runtime-mode-label"
                describedBy="budget-error"
                disabled={!settingsReady}
                loading={settingsLoading && !field.value}
              />
            )}
          />
        </div>
      </div>
      <div id="budget-error" className="form-error" role="alert">
        {errors.costMode?.message ??
          errors.runtime?.message ??
          errors.cost?.message}
      </div>
    </>
  );
}

export function DependencyField({
  tasks,
  loading = false,
  projectsLoading = false,
  disabled = false,
}: {
  tasks: Task[];
  loading?: boolean;
  projectsLoading?: boolean;
  disabled?: boolean;
}) {
  const { control } = useFormContext<DelegateValues>(),
    repository = useWatch({ control, name: "repository" });

  return (
    <Field id="deps" label="Wait for tasks (optional)">
      <FormSelect
        searchable
        multiple
        control={control}
        name="deps"
        id="deps"
        label="Wait for tasks (optional)"
        disabled={loading || projectsLoading || disabled}
        loading={loading || projectsLoading}
        loadingLabel={
          projectsLoading
            ? "Loading project options for dependencies"
            : "Loading tasks for dependency options"
        }
        placeholder="No dependencies"
        options={tasks
          .filter((task) => task.repository === repository)
          .map((task) => ({ value: task.id, label: task.title }))}
      />
    </Field>
  );
}

interface ModelFieldsProps {
  defaults: Defaults;
  workers: Worker[];
  settingsReady?: boolean;
  workersReady?: boolean;
  settingsLoading?: boolean;
  workersLoading?: boolean;
}

export function ModelFields({
  defaults,
  workers,
  settingsReady = true,
  workersReady = true,
  settingsLoading = false,
  workersLoading = false,
}: ModelFieldsProps) {
  const { control } = useFormContext<DelegateValues>();

  const [worker, selectedModel, selectedEffort] = useWatch({
    control,
    name: ["worker", "model", "reasoning_effort"],
  });

  const { provider, profile: role } = workerChoice(worker);

  const model =
    defaults[`${role}_default_model`] ||
    defaults[`${provider}_default_model`] ||
    defaults.default_model;

  const reasoning = [
    defaults[`${role}_default_reasoning_effort`],
    defaults[`${provider}_default_reasoning_effort`],
    defaults.default_reasoning_effort,
  ].find((value) => value && value !== "default");

  const workerInfo = workers.find((item) => item.provider === provider);

  const metadata = workerInfo?.models?.find(
    (item) => item.value === (selectedModel.trim() || model || "default"),
  );

  const supported =
    metadata?.supportsEffort === false
      ? []
      : (metadata?.supportedEffortLevels ??
        providerMetadata(provider, workerInfo?.metadata)?.defaultEffortLevels ??
        reasoningLevels);

  return (
    <>
      <Field id="model" label="Model">
        <AsyncControl
          loading={workersLoading || (settingsLoading && !selectedModel)}
          label="Loading model defaults and available models"
        >
          <ModelAutocomplete
            models={workerInfo?.models ?? []}
            placeholder={
              settingsReady
                ? model || "Provider runtime default"
                : pendingPlaceholder(settingsLoading)
            }
            describedBy="model-help"
            disabled={!settingsReady || !workersReady}
          />
        </AsyncControl>
        <p id="model-help" className="help">
          Leave blank to inherit {model || "the provider runtime default"}.
          Choose a discovered model or enter a model ID or provider alias.
          {workerInfo?.model_discovery_error &&
            ` ${workerInfo.model_discovery_error}`}
          {(!metadata ||
            (metadata.supportsEffort !== false &&
              metadata.supportedEffortLevels === undefined)) &&
            " Reasoning support for this model is unknown."}
        </p>
      </Field>
      <Field id="reasoning-effort" label="Reasoning effort">
        <FormSelect
          control={control}
          name="reasoning_effort"
          id="reasoning-effort"
          label="Reasoning effort"
          disabled={!settingsReady || !workersReady}
          loading={
            workersLoading ||
            (settingsLoading &&
              (!selectedEffort || selectedEffort === "default"))
          }
          loadingLabel="Loading reasoning options"
          placeholder={
            !settingsReady && !selectedEffort
              ? pendingPlaceholder(settingsLoading)
              : undefined
          }
          rules={{
            validate: (value) => {
              const resolved = value === "default" ? reasoning : value;

              return (
                !resolved ||
                supported.some((level) => level === resolved) ||
                `Choose a reasoning effort supported by ${provider}${metadata ? ` model ${metadata.value}` : ""}: ${supported.length ? supported.join(", ") : "use the provider runtime default"}.`
              );
            },
          }}
          options={[
            {
              value: "default",
              label: `Use default (${reasoning || "provider runtime"})`,
            },
            // Stable options preserve the draft when switching providers or correcting an effort.
            ...reasoningLevels.map((level) => ({
              value: level,
              label: supported.some((item) => item === level)
                ? level
                : `${level} (unsupported by ${provider})`,
            })),
          ]}
        />
      </Field>
    </>
  );
}

export function ApprovalField({
  workers,
  disabled = false,
  loading = false,
}: {
  workers: Worker[];
  disabled?: boolean;
  loading?: boolean;
}) {
  const { control } = useFormContext<DelegateValues>();
  const worker = useWatch({ control, name: "worker" });
  const { provider } = workerChoice(worker);
  const info = workers.find((item) => item.provider === provider);

  const permissions = providerMetadata(
    provider,
    info?.metadata,
  )?.nativePermissions;

  const unresolved = loading && !info,
    permissionOptions =
      permissions?.options ??
      (unresolved ? [] : [{ value: "inherit", label: "Inherit" }]);

  return (
    <>
      <Field id="permission-mode" label="Permission mode">
        <FormSelect
          control={control}
          name="permission_mode"
          id="permission-mode"
          label="Permission mode"
          disabled={disabled || !permissions}
          loading={loading}
          loadingLabel="Loading permission options"
          placeholder={unresolved ? "Loading…" : undefined}
          options={permissionOptions}
        />
        <p className="help">
          {unresolved
            ? "Loading permission options."
            : (permissions?.help ??
              "Native permission mode selection is available for providers that declare it.")}
        </p>
      </Field>
      <Presence show={Boolean(permissions?.approvalDecider) || unresolved}>
        <Field id="approval-decider" label="Approval decision maker">
          <FormSelect
            control={control}
            name="approval_decider"
            id="approval-decider"
            label="Approval decision maker"
            disabled={disabled}
            loading={loading}
            loadingLabel="Loading approval options"
            placeholder={unresolved ? "Loading…" : undefined}
            options={
              unresolved
                ? []
                : [
                    { value: "user", label: "User" },
                    { value: "parent_agent", label: "Parent agent" },
                  ]
            }
          />
          <p className="help">
            {unresolved
              ? "Loading approval options."
              : permissions?.approvalDeciderHelp}
          </p>
        </Field>
      </Presence>
    </>
  );
}
