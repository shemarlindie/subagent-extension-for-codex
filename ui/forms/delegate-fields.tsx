import { useFormContext, useWatch } from "react-hook-form";
import {
  permissionLabels,
  permissionModeSchema,
} from "../../src/core/permissions";
import { reasoningLevels } from "../../src/core/reasoning";
import type { Defaults, Project, Task, Worker } from "../core/types";
import { profileLabel } from "../core/selectors";
import { Button } from "../components/button";
import { Field } from "./fields";
import { FormSelect } from "./form-select";
import { ProjectAutocomplete } from "./project-autocomplete";
import { ModelAutocomplete } from "./model-autocomplete";
export type DelegateValues = {
  permission_mode: keyof typeof permissionLabels;
  approval_decider: "user" | "parent_agent";
  repository: string;
  description: string;
  worker: string;
  model: string;
  reasoning_effort: string;
  revision: string;
  workspace_strategy: "worktree" | "current_repo";
  context: string;
  runtimeMode: string;
  runtime: number;
  costMode: string;
  cost: number;
  deps: string[];
};
interface ProjectFieldProps {
  projects: Project[];
  allowParent: boolean;
  disabled?: boolean;
  onBrowse?: () => void;
}
export function ProjectField({
  projects,
  allowParent,
  disabled = false,
  onBrowse,
}: ProjectFieldProps) {
  const { control } = useFormContext<DelegateValues>(),
    options = projects.filter((project) => project.kind === "repository");
  return (
    <Field id="repository" label="Project">
      <div className="project-selection">
        <div className="project-selection-control">
          {allowParent ? (
            <ProjectAutocomplete
              disabled={disabled}
              repositories={options.map((project) => project.repository)}
            />
          ) : (
            <FormSelect
              control={control}
              name="repository"
              id="repository"
              label="Project"
              required
              disabled={disabled}
              placeholder="Choose a project"
              rules={{ required: "Choose a project before starting a task." }}
              options={options.map((project) => ({
                value: project.repository,
                label: project.pending
                  ? `${project.repository} (chat project, added when the task starts)`
                  : project.repository,
              }))}
            />
          )}
        </div>
        {onBrowse && (
          <Button
            disabled={disabled}
            onClick={onBrowse}
            title="Choose and add a repository on the service host"
          >
            Browse…
          </Button>
        )}
      </div>
      {allowParent && (
        <p className="help">
          Use a registered Git root or a Git repository inside an approved
          parent.
        </p>
      )}
    </Field>
  );
}
export function WorkspaceField() {
  const { control } = useFormContext<DelegateValues>();
  return (
    <Field id="workspace-strategy" label="Workspace">
      <FormSelect
        control={control}
        name="workspace_strategy"
        id="workspace-strategy"
        label="Workspace"
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
export function WorkerFields({ workers }: { workers: Worker[] }) {
  const { register, control } = useFormContext<DelegateValues>();
  const strategy = useWatch({ control, name: "workspace_strategy" });
  return (
    <div className="two">
      <div>
        <Field id="worker" label="Worker">
          <FormSelect
            control={control}
            name="worker"
            id="worker"
            label="Worker"
            options={workers.flatMap((worker) =>
              worker.profiles.map((profile) => ({
                value: `${worker.provider}:${profile}`,
                label: `${worker.provider} · ${profileLabel(profile)}`,
              })),
            )}
          />
        </Field>
      </div>
      <div>
        <Field id="revision" label="Revision">
          <input
            id="revision"
            readOnly={strategy === "current_repo"}
            required
            {...register("revision", { required: true })}
          />
        </Field>
      </div>
    </div>
  );
}
export function BudgetFields({ workers }: { workers: Worker[] }) {
  const {
      register,
      control,
      formState: { errors },
    } = useFormContext<DelegateValues>(),
    [worker, mode, runtimeMode] = useWatch({
      control,
      name: ["worker", "costMode", "runtimeMode"],
    });
  const provider = workers.find(
    (item) => item.provider === worker.split(":")[0],
  );
  return (
    <>
      <div className="two">
        <Field id="cost-mode" label="Cost limit">
          <FormSelect
            control={control}
            name="costMode"
            id="cost-mode"
            label="Cost limit"
            options={[
              { value: "limited", label: "Apply cost budget" },
              { value: "none", label: "No cost limit" },
            ]}
            rules={{
              validate: (value) =>
                value === "none" ||
                Boolean(provider?.capabilities.cost_budget) ||
                "This worker cannot enforce a cost budget. Choose No cost limit.",
            }}
          />
        </Field>
        <Field id="cost" label="Cost budget · USD">
          <input
            id="cost"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            disabled={mode === "none"}
            required={mode !== "none"}
            aria-describedby="cost-note budget-error"
            {...register("cost", {
              valueAsNumber: true,
              validate: (value) =>
                mode === "none" ||
                (Number.isFinite(value) && value > 0 && value <= 100) ||
                "Cost budget must be greater than zero and at most $100.",
            })}
          />
        </Field>
      </div>
      <p id="cost-note" className="help">
        {mode === "none"
          ? runtimeMode === "none"
            ? "No cost or runtime limit applies."
            : "Only the runtime limit applies."
          : provider?.provider === "claude"
            ? "Claude checks cost after a response. The budget may be exceeded; interrupted usage may be missing."
            : provider?.capabilities.cost_budget
              ? "Provider cost budget applies."
              : "This provider requires No cost limit."}
      </p>
      <div className="two">
        <Field id="runtime-mode" label="Runtime limit">
          <FormSelect
            control={control}
            name="runtimeMode"
            id="runtime-mode"
            label="Runtime limit"
            options={[
              { value: "limited", label: "Apply runtime budget" },
              { value: "none", label: "No runtime limit" },
            ]}
          />
        </Field>
        <Field id="runtime" label="Runtime limit · minutes">
          <input
            id="runtime"
            type="number"
            min="0"
            max="120"
            step="any"
            disabled={runtimeMode === "none"}
            required={runtimeMode !== "none"}
            aria-describedby="budget-error"
            {...register("runtime", {
              valueAsNumber: true,
              validate: (value) =>
                runtimeMode === "none" ||
                (Number.isFinite(value) && value > 0 && value <= 120) ||
                "Runtime limit must be greater than zero and at most 120 minutes.",
            })}
          />
        </Field>
      </div>
      <div id="budget-error" className="form-error" role="alert">
        {errors.runtime?.message ?? errors.cost?.message}
      </div>
    </>
  );
}
export function DependencyField({ tasks }: { tasks: Task[] }) {
  const { control } = useFormContext<DelegateValues>(),
    repository = useWatch({ control, name: "repository" });
  return (
    <Field id="deps" label="Wait for tasks (optional)">
      <FormSelect
        multiple
        control={control}
        name="deps"
        id="deps"
        label="Wait for tasks (optional)"
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
}
export function ModelFields({ defaults, workers }: ModelFieldsProps) {
  const { control } = useFormContext<DelegateValues>();
  const [worker, selectedModel] = useWatch({
    control,
    name: ["worker", "model"],
  });
  const [provider, role] = worker.split(":");
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
        reasoningLevels.filter(
          (level) =>
            provider !== "claude" || !["none", "minimal"].includes(level),
        ));
  return (
    <>
      <Field id="model" label="Model">
        <ModelAutocomplete
          models={workerInfo?.models ?? []}
          placeholder={model || "Provider runtime default"}
          describedBy="model-help"
        />
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

export function ApprovalField() {
  const { control } = useFormContext<DelegateValues>();
  const worker = useWatch({ control, name: "worker" });
  const claude = worker?.split(":")[0] === "claude";
  return (
    <>
      <Field id="permission-mode" label="Permission mode">
        <FormSelect
          control={control}
          name="permission_mode"
          id="permission-mode"
          label="Permission mode"
          disabled={!claude}
          options={permissionModeSchema.options.map((value) => ({
            value,
            label: permissionLabels[value],
          }))}
        />
        <p className="help">
          {claude
            ? "Claude native SDK mode. Inherit uses your Claude Code settings, or plan for read-only profiles; settings can override it."
            : "Native permission mode selection is available for Claude."}
        </p>
      </Field>
      {claude && (
        <Field id="approval-decider" label="Approval decision maker">
          <FormSelect
            control={control}
            name="approval_decider"
            id="approval-decider"
            label="Approval decision maker"
            options={[
              { value: "user", label: "User" },
              { value: "parent_agent", label: "Parent agent" },
            ]}
          />
          <p className="help">
            Who answers permission requests that the SDK leaves unresolved.
          </p>
        </Field>
      )}
    </>
  );
}
