import { type FormEvent, useEffect, useRef } from "react";
import { FormProvider, useWatch } from "react-hook-form";

import { providerMetadata } from "../../../shared/providers/metadata";
import { useController, useSnapshot } from "../../app/state/controller-context";
import type {
  Defaults,
  DialogReadStatus,
  DialogState,
  Task,
} from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/motion";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { Field } from "../../shared/forms/fields";
import { FormFieldError } from "../../shared/forms/form-field-error";
import { FormFooter } from "../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../shared/forms/use-persisted-dialog-form";
import {
  ApprovalField,
  BudgetFields,
  type DelegateValues,
  DependencyField,
  ModelFields,
  ProjectField,
  WorkerFields,
  WorkspaceField,
} from "./delegate-fields";
import { taskProjects } from "./delegation";
import { providerOptionDefaults } from "./provider-defaults";

type DelegateFormDialog =
  | Extract<DialogState, { kind: "delegate" }>
  | Extract<DialogState, { kind: "delegate-loading" }>;

interface DelegateFormProps {
  dialog: DelegateFormDialog;
}

const FALLBACK_DEFAULTS: Defaults = {
  max_runtime_minutes: null,
  max_cost_usd: null,
};

const READY = {
  context: "ready",
  settings: "ready",
  projects: "ready",
  workers: "ready",
} satisfies Record<
  "context" | "settings" | "projects" | "workers",
  DialogReadStatus
>;

/** A new task's revision: blank until settings and context load, HEAD for the current repo. */
function startingRevision(ready: boolean, strategy: string, revision: string) {
  if (!ready) return "";

  return strategy === "current_repo" ? "HEAD" : revision;
}

/** A new task's worker: the dialog's choice, then the default, then the first available. */
function startingWorker(
  choices: string[],
  preferredWorker: string | undefined,
  preferred: string,
  settingsReady: boolean,
) {
  if (preferredWorker && choices.includes(preferredWorker)) {
    return preferredWorker;
  }

  if (!settingsReady) return "";

  return choices.includes(preferred) ? preferred : (choices[0] ?? "");
}

/** A budget's starting mode: blank until settings load, then limited unless turned off. */
function startingBudgetMode(settingsReady: boolean, unlimited: boolean) {
  if (!settingsReady) return "";

  return unlimited ? "none" : "limited";
}

export function DelegateForm({ dialog }: DelegateFormProps) {
  const controller = useController(),
    state = useSnapshot(),
    loading = dialog.kind === "delegate-loading",
    statuses = loading ? dialog.statuses : READY,
    errors = loading ? dialog.errors : undefined,
    defaults =
      dialog.kind === "delegate"
        ? dialog.defaults
        : (dialog.defaults ?? FALLBACK_DEFAULTS);

  const persistedDraft = useRef(controller.getDialogDraft("delegate") ?? {}),
    settingsReady = statuses.settings === "ready",
    contextReady = statuses.context === "ready",
    pendingNumber = (key: "runtime" | "cost"): number | "" => {
      const value = persistedDraft.current[key];

      return typeof value === "number" && Number.isFinite(value) ? value : "";
    };

  const choices = state.workers.flatMap((worker) =>
    worker.profiles.map((profile) => `${worker.provider}:${profile}`),
  );

  const preferred =
    dialog.preferredWorker ??
    `${defaults.default_provider ?? ""}:${defaults.default_worker_profile ?? ""}`;

  const [preferredProvider] = preferred.split(":"),
    preferredWorker = state.workers.find(
      (worker) => worker.provider === preferredProvider,
    ),
    optionDefaults = providerOptionDefaults(
      preferredProvider,
      preferredWorker?.metadata,
      defaults,
    );

  const strategyDefault = settingsReady
      ? (defaults.default_workspace_strategy ?? "current_repo")
      : "",
    resolvedRepository =
      dialog.kind === "delegate"
        ? dialog.repository
        : (dialog.repository ??
          (state.scopeKnown ? state.repository : undefined)),
    resolvedRevision =
      dialog.kind === "delegate"
        ? dialog.revision
        : (dialog.revision ?? (state.scopeKnown ? state.revision : "HEAD")),
    initialValues: DelegateValues = {
      ...optionDefaults,
      repository: resolvedRepository ?? "",
      revision: startingRevision(
        settingsReady && contextReady,
        strategyDefault,
        resolvedRevision,
      ),
      workspace_strategy: strategyDefault,
      description: "",
      model: "",
      worker: startingWorker(
        choices,
        dialog.preferredWorker,
        preferred,
        settingsReady,
      ),
      runtimeMode: startingBudgetMode(
        settingsReady,
        defaults.use_runtime_budget === false ||
          defaults.max_runtime_minutes === null,
      ),
      runtime: settingsReady
        ? (defaults.max_runtime_minutes ?? 20)
        : pendingNumber("runtime"),
      costMode: startingBudgetMode(
        settingsReady,
        defaults.use_cost_budget === false || defaults.max_cost_usd === null,
      ),
      cost: settingsReady
        ? (defaults.max_cost_usd ?? 5)
        : pendingNumber("cost"),
      reasoning_effort: settingsReady ? "default" : "",
      context: "",
      deps: [],
    };

  const previousInitialValues = useRef(initialValues),
    form = usePersistedDialogForm<DelegateValues>("delegate", initialValues);

  // Async defaults fill untouched fields while preserving saved and active edits.
  useEffect(() => {
    for (const key of Object.keys(initialValues) as (keyof DelegateValues)[]) {
      if (Object.is(initialValues[key], previousInitialValues.current[key])) {
        continue;
      }

      const field = form.getFieldState(key);

      if (key in persistedDraft.current || field.isDirty || field.isTouched) {
        continue;
      }

      form.setValue(key, initialValues[key] as never, { shouldDirty: false });
    }

    previousInitialValues.current = initialValues;
  });

  const [repository, selectedWorker] = useWatch({
    control: form.control,
    name: ["repository", "worker"],
  });

  const previous = useRef(repository);

  const requiredReadsReady =
      statuses.context === "ready" &&
      statuses.settings === "ready" &&
      statuses.projects === "ready" &&
      statuses.workers === "ready",
    hasWorkers = choices.length > 0,
    selectedWorkerReady =
      state.workers.find(
        (worker) => worker.provider === selectedWorker.split(":")[0],
      )?.readiness?.ready !== false,
    canSubmit =
      requiredReadsReady &&
      hasWorkers &&
      choices.includes(selectedWorker) &&
      Boolean(selectedWorker) &&
      Boolean(repository.trim()) &&
      selectedWorkerReady,
    failedReads = (Object.keys(statuses) as (keyof typeof statuses)[]).filter(
      (resource) => statuses[resource] === "error",
    ),
    submit = form.handleSubmit((values) =>
      controller.submit(async () => {
        const [provider, worker_profile] = values.worker.split(":");

        const worker = state.workers.find((item) => item.provider === provider);

        const permissions = providerMetadata(
          provider,
          worker?.metadata,
        )?.nativePermissions;

        const nativeOptions = permissions
          ? {
              [permissions.permissionOption]: values.permission_mode,
              ...(permissions.approvalDeciderOption
                ? {
                    [permissions.approvalDeciderOption]:
                      values.approval_decider,
                  }
                : {}),
            }
          : undefined;

        await controller.addChatProjectForTask(values.repository);

        return controller.tool<Task>("start_agent_task", {
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
            values.workspace_strategy === "current_repo"
              ? "HEAD"
              : values.revision,
          workspace_strategy: values.workspace_strategy,
          conversation_id: conversation ?? null,
          context: values.context.trim() ? [values.context] : [],
          depends_on: values.deps,
          budget: {
            max_runtime_minutes:
              values.runtimeMode === "none" ? null : Number(values.runtime),
            max_cost_usd:
              values.costMode === "none" ? null : Number(values.cost),
          },
        });
      }, true),
    );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmit) {
      event.preventDefault();

      return;
    }

    void submit(event);
  }

  // Project changes reset only project-bound defaults, preserving the task draft.
  useEffect(() => {
    if (repository !== previous.current) {
      form.setValue(
        "revision",
        repository === resolvedRepository ? resolvedRevision : "HEAD",
      );

      form.setValue("deps", []);
      previous.current = repository;
    }
  }, [repository, form, resolvedRepository, resolvedRevision]);

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
      <form noValidate onSubmit={handleSubmit}>
        <p className="form-note form-note--first">
          Describe what you want done and include any important details.
        </p>
        <Presence show={failedReads.length > 0}>
          <div className="form-error form-field-error" role="alert">
            <span>
              {errors?.settings
                ? `Task defaults could not be loaded: ${errors.settings}`
                : "Some task options could not be loaded. See the affected field."}
            </span>
            <Button variant="text" onClick={() => controller.retryDialogLoad()}>
              Retry loading
            </Button>
          </div>
        </Presence>
        <FormFieldError message={loading ? dialog.message : undefined} />
        <ProjectField
          projects={taskProjects(state)}
          loading={statuses.projects === "loading"}
          contextLoading={statuses.context === "loading"}
          error={errors?.projects}
          contextError={errors?.context}
          disabled={
            state.busy ||
            statuses.projects !== "ready" ||
            statuses.context === "loading"
          }
          browseDisabled={state.busy || loading}
          onBrowse={() =>
            controller.run(async () => {
              const repository = await controller.browseTaskProject();

              // Keep selection in this draft; changing panel scope would discard it.
              if (repository) {
                form.setValue("repository", repository, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }
            })
          }
          allowParent={state.projects.some(
            (project) => project.kind === "parent",
          )}
        />
        <Field id="description" label="Description">
          <textarea
            id="description"
            required
            maxLength={20000}
            placeholder="Review the authentication boundary. Cite findings with file paths and suggest next steps."
            {...form.register("description", { required: true })}
          />
        </Field>
        <WorkspaceField
          settingsReady={statuses.settings === "ready"}
          settingsLoading={statuses.settings === "loading"}
        />
        <ApprovalField
          workers={state.workers}
          disabled={
            statuses.workers !== "ready" || statuses.settings !== "ready"
          }
          loading={
            statuses.workers === "loading" || statuses.settings === "loading"
          }
        />
        <WorkerFields
          workers={state.workers}
          loading={
            statuses.workers === "loading" ||
            (statuses.settings === "loading" && !selectedWorker)
          }
          error={errors?.workers}
          disabled={
            statuses.workers !== "ready" || statuses.settings !== "ready"
          }
          revisionDisabled={
            statuses.context !== "ready" || statuses.settings !== "ready"
          }
          revisionLoading={
            statuses.context === "loading" || statuses.settings === "loading"
          }
        />
        <ModelFields
          defaults={defaults}
          workers={state.workers}
          settingsReady={statuses.settings === "ready"}
          workersReady={statuses.workers === "ready"}
          settingsLoading={statuses.settings === "loading"}
          workersLoading={statuses.workers === "loading"}
        />
        <Field id="context" label="Context to include (optional)">
          <textarea
            id="context"
            maxLength={20000}
            placeholder="Relevant files, constraints, or prior findings. Conversation context is not attached automatically."
            {...form.register("context")}
          />
        </Field>
        <BudgetFields
          workers={state.workers}
          settingsReady={statuses.settings === "ready"}
          workersReady={statuses.workers === "ready"}
          settingsLoading={statuses.settings === "loading"}
        />
        <DependencyField
          tasks={state.tasks}
          loading={state.taskListLoading}
          projectsLoading={
            statuses.projects === "loading" || statuses.context === "loading"
          }
          disabled={
            statuses.projects !== "ready" || statuses.context === "loading"
          }
        />
        <FormFooter label="Start task" disabled={!canSubmit} />
      </form>
    </FormProvider>
  );
}

export const delegateDialog = defineDialog<"delegate">({
  title: () => "New Task",
  render: (dialog) => <DelegateForm dialog={dialog} />,
  // With a known repository the project is settled, so start on the description.
  initialFocus: (popup, { repository }) =>
    repository
      ? (popup?.querySelector<HTMLElement>("#description") ?? null)
      : null,
});

export const delegateLoadingDialog = defineDialog<"delegate-loading">({
  title: () => "New Task",
  render: (dialog) => <DelegateForm dialog={dialog} />,
  initialFocus: (popup) =>
    popup?.querySelector<HTMLElement>("#description") ?? null,
});
