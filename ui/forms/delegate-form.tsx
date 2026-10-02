import { useEffect, useRef } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import type { DialogState, Task } from "../core/types";
import { useController, useSnapshot } from "../components/controller-context";
import {
  BudgetFields,
  DependencyField,
  ProjectField,
  WorkerFields,
  WorkspaceField,
  type DelegateValues,
} from "./delegate-fields";
import { Field } from "./fields";
import { FormFooter } from "./form-footer";
export function DelegateForm({
  dialog,
}: {
  dialog: Extract<DialogState, { kind: "delegate" }>;
}) {
  const controller = useController(),
    state = useSnapshot(),
    defaults = dialog.defaults;
  const choices = state.workers.flatMap((worker) =>
    worker.profiles.map((profile) => `${worker.provider}:${profile}`),
  );
  const preferred =
    dialog.preferredWorker ??
    `${defaults.default_provider}:${defaults.default_worker_profile}`;
  const strategyDefault = defaults.default_workspace_strategy ?? "current_repo";
  const form = useForm<DelegateValues>({
    defaultValues: {
      repository: dialog.repository ?? "",
      revision: strategyDefault === "current_repo" ? "HEAD" : dialog.revision,
      workspace_strategy: strategyDefault,
      task: "",
      worker: choices.includes(preferred) ? preferred : choices[0],
      runtime: defaults.max_runtime_minutes,
      costMode:
        defaults.use_cost_budget === false || defaults.max_cost_usd === null
          ? "none"
          : "limited",
      cost: defaults.max_cost_usd ?? 5,
      context: "",
      deps: [],
    },
  });
  const repository = useWatch({ control: form.control, name: "repository" }),
    previous = useRef(repository);
  // Project changes reset only project-bound defaults, preserving the task draft.
  useEffect(() => {
    if (repository !== previous.current) {
      form.setValue(
        "revision",
        repository === dialog.repository ? dialog.revision : "HEAD",
      );
      form.setValue("deps", []);
      previous.current = repository;
    }
  }, [repository, form, dialog.repository, dialog.revision]);
  const strategy = useWatch({
    control: form.control,
    name: "workspace_strategy",
  });
  useEffect(() => {
    if (strategy === "current_repo") form.setValue("revision", "HEAD");
  }, [strategy, repository, form]);
  const conversation = useRef(state.conversation).current;
  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          controller.submit(() => {
            const [provider, worker_profile] = values.worker.split(":");
            return controller.tool<Task>("start_agent_task", {
              repository: values.repository,
              task: values.task,
              provider,
              worker_profile,
              revision:
                values.workspace_strategy === "current_repo"
                  ? "HEAD"
                  : values.revision,
              workspace_strategy: values.workspace_strategy,
              conversation_id: conversation ?? null,
              context: values.context.trim() ? [values.context] : [],
              depends_on: values.deps,
              budget: {
                max_runtime_minutes: values.runtime,
                max_cost_usd: values.costMode === "none" ? null : values.cost,
              },
            });
          }, true),
        )}
      >
        <p className="form-note">
          Give the worker a focused outcome and the evidence you expect back.{" "}
          {strategy === "current_repo"
            ? "Current repository includes uncommitted changes. Write profiles edit this checkout directly."
            : "Work starts from a committed revision in a separate worktree."}
        </p>
        <ProjectField
          projects={state.projects}
          allowParent={
            state.mode === "panel" &&
            state.projects.some((project) => project.kind === "parent")
          }
        />
        <Field id="task" label="Task">
          <textarea
            id="task"
            required
            maxLength={20000}
            placeholder="Review the authentication boundary. Cite findings with file paths and suggest next steps."
            {...form.register("task", { required: true })}
          />
        </Field>
        <WorkspaceField />
        <WorkerFields workers={state.workers} />
        <Field id="context" label="Context to include (optional)">
          <textarea
            id="context"
            maxLength={20000}
            placeholder="Relevant files, constraints, or prior findings. Conversation context is not attached automatically."
            {...form.register("context")}
          />
        </Field>
        <BudgetFields workers={state.workers} />
        <DependencyField tasks={state.tasks} />
        <FormFooter label="Start task" />
      </form>
    </FormProvider>
  );
}
