import { useFormContext, useWatch } from "react-hook-form";
import type { Project, Task, Worker } from "../core/types";
import { profileLabel } from "../core/selectors";
import { Field } from "./fields";
import { FormSelect } from "./form-select";
import { ProjectAutocomplete } from "./project-autocomplete";
export type DelegateValues = {
  repository: string;
  description: string;
  worker: string;
  revision: string;
  workspace_strategy: "worktree" | "current_repo";
  context: string;
  runtime: number;
  costMode: string;
  cost: number;
  deps: string[];
};
export function ProjectField({
  projects,
  allowParent,
}: {
  projects: Project[];
  allowParent: boolean;
}) {
  const { control } = useFormContext<DelegateValues>(),
    options = projects.filter((project) => project.kind === "repository");
  return (
    <Field id="repository" label="Project">
      {allowParent ? (
        <>
          <ProjectAutocomplete
            repositories={options.map((project) => project.repository)}
          />
          <p className="help">
            Use a registered Git root or a Git repository inside an approved
            parent.
          </p>
        </>
      ) : (
        <FormSelect
          control={control}
          name="repository"
          id="repository"
          label="Project"
          required
          placeholder="Choose a project"
          rules={{ required: "Choose a project before starting a task." }}
          options={options.map((project) => ({
            value: project.repository,
            label: project.repository,
          }))}
        />
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
    [worker, mode] = useWatch({ control, name: ["worker", "costMode"] });
  const provider = workers.find(
    (item) => item.provider === worker.split(":")[0],
  );
  return (
    <>
      <div className="two">
        <div>
          <Field id="runtime" label="Runtime limit · minutes">
            <input
              id="runtime"
              type="number"
              min="0"
              max="120"
              step="any"
              required
              aria-describedby="budget-error"
              {...register("runtime", {
                valueAsNumber: true,
                validate: (value) =>
                  (Number.isFinite(value) && value > 0 && value <= 120) ||
                  "Runtime limit must be greater than zero and at most 120 minutes.",
              })}
            />
          </Field>
        </div>
        <div>
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
        </div>
      </div>
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
      <p id="cost-note" className="help">
        {mode === "none"
          ? "Only the runtime limit applies."
          : provider?.provider === "claude"
            ? "Claude checks cost after a response. The budget may be exceeded; interrupted usage may be missing."
            : provider?.capabilities.cost_budget
              ? "Provider cost budget applies."
              : "This provider requires No cost limit."}
      </p>
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
