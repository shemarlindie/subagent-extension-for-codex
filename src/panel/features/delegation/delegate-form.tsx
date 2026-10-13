import { type SubmitEvent, useEffect, useRef } from "react";
import { FormProvider, useWatch } from "react-hook-form";

import { providerMetadata } from "../../../shared/providers/metadata";
import { useController, useSnapshot } from "../../app/state/controller-context";
import type { Task } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { Field } from "../../shared/forms/fields";
import { FormFieldError } from "../../shared/forms/form-field-error";
import { FormFooter } from "../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../shared/forms/use-persisted-dialog-form";
import {
  type DelegateFormDialog,
  delegateInitialValues,
  delegateReads,
  delegateTarget,
  workerChoices,
} from "./delegate-initial-values";
import type { DelegateValues } from "./delegate-values";
import { taskProjects, workerChoice } from "./delegation";
import { ApprovalField } from "./fields/approval-field";
import { BudgetFields } from "./fields/budget-fields";
import { DependencyField } from "./fields/dependency-field";
import { ModelFields } from "./fields/model-fields";
import { ProjectField } from "./fields/project-field";
import { WorkerFields } from "./fields/worker-fields";
import { WorkspaceField } from "./fields/workspace-field";

interface DelegateFormProps {
  dialog: DelegateFormDialog;
}

function DelegateForm({ dialog }: DelegateFormProps) {
  const controller = useController(),
    state = useSnapshot(),
    { loading, statuses, errors, message, defaults } = delegateReads(dialog),
    persistedDraft = useRef(controller.getDialogDraft("delegate") ?? {}),
    choices = workerChoices(state.workers),
    { repository: resolvedRepository, revision: resolvedRevision } =
      delegateTarget(dialog, state),
    initialValues = delegateInitialValues({
      dialog,
      scope: state,
      draft: persistedDraft.current,
    });

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

      form.setValue(key, initialValues[key], { shouldDirty: false });
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
        (worker) => worker.provider === workerChoice(selectedWorker).provider,
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
        const { provider, profile: worker_profile } = workerChoice(
          values.worker,
        );

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

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
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
        <FormFieldError message={message} />
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
