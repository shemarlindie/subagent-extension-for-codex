import { type SubmitEvent, useEffect, useRef } from "react";
import { FormProvider, useWatch } from "react-hook-form";

import { readOnlyProfile } from "../../../shared/providers/claude/permissions";
import { useController, useSnapshot } from "../../app/state/controller-context";
import type { Task } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { Field } from "../../shared/forms/fields";
import { FormFieldError } from "../../shared/forms/form-field-error";
import { FormFooter } from "../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../shared/forms/use-persisted-dialog-form";
import { runsInPlace } from "../projects/selectors";
import {
  type DelegateFormDialog,
  delegateInitialValues,
  delegateReads,
  delegateTarget,
  workerChoices,
} from "./delegate-initial-values";
import type { DelegateValues } from "./delegate-values";
import { projectGit, taskProjects, workerChoice } from "./delegation";
import { ApprovalField } from "./fields/approval-field";
import { BudgetFields } from "./fields/budget-fields";
import { DependencyField } from "./fields/dependency-field";
import { ModelFields } from "./fields/model-fields";
import { ProjectField } from "./fields/project-field";
import { RevisionField } from "./fields/revision-field";
import { WorkerField } from "./fields/worker-field";
import { WorkspaceField } from "./fields/workspace-field";
import { WorkspaceNoteView } from "./fields/workspace-note-view";
import { startTaskArguments } from "./start-task";
import { useAsyncDefaults, useProfileMode } from "./use-async-defaults";
import { workspaceNote } from "./workspace-note";

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

  const form = usePersistedDialogForm<DelegateValues>(
    "delegate",
    initialValues,
  );

  useAsyncDefaults(form, initialValues, persistedDraft.current);
  useProfileMode(form, initialValues.permission_mode, persistedDraft.current);

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
        await controller.addChatProjectForTask(values.repository);

        return controller.tool<Task>(
          "start_task",
          startTaskArguments(
            values,
            state.workers,
            conversation,
            projectGit(state, values.repository),
          ),
        );
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

  // A project with no commit has one valid workspace. Leaving it restores the
  // saved default, the value the form would have started with.
  const git = projectGit(state, repository),
    inPlace = runsInPlace(git),
    savedStrategy = defaults.task.workspace_strategy,
    wasInPlace = useRef(false);

  useEffect(() => {
    // Async defaults can fill the saved value after this project is chosen.
    if (inPlace && strategy !== "current_repo") {
      form.setValue("workspace_strategy", "current_repo");
    } else if (!inPlace && wasInPlace.current) {
      form.setValue("workspace_strategy", savedStrategy);
    }

    wasInPlace.current = inPlace;
  }, [inPlace, strategy, savedStrategy, form]);

  // The project folder runs on its checkout, so only a worktree takes a revision.
  const revisionShown = !inPlace && strategy !== "current_repo";

  const conversation = useRef(state.conversation).current;

  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={handleSubmit}>
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
        <div
          className={revisionShown ? "two task-workspace-fields" : undefined}
        >
          <div>
            <WorkspaceField
              settingsReady={statuses.settings === "ready"}
              settingsLoading={statuses.settings === "loading"}
              inPlace={inPlace}
            />
          </div>
          {revisionShown && (
            <div>
              <RevisionField
                disabled={
                  statuses.context !== "ready" || statuses.settings !== "ready"
                }
                loading={
                  statuses.context === "loading" ||
                  statuses.settings === "loading"
                }
              />
            </div>
          )}
        </div>
        <WorkspaceNoteView
          note={workspaceNote({
            git,
            savedStrategy,
            readOnly: readOnlyProfile(
              workerChoice(selectedWorker).profile ?? "",
            ),
          })}
        />
        <WorkerField
          workers={state.workers}
          loading={
            statuses.workers === "loading" ||
            (statuses.settings === "loading" && !selectedWorker)
          }
          error={errors?.workers}
          disabled={
            statuses.workers !== "ready" || statuses.settings !== "ready"
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
        <ApprovalField
          workers={state.workers}
          disabled={
            statuses.workers !== "ready" || statuses.settings !== "ready"
          }
          loading={
            statuses.workers === "loading" || statuses.settings === "loading"
          }
        />
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
  title: () => "Advanced task",
  render: (dialog) => <DelegateForm dialog={dialog} />,
  // With a known repository the project is settled, so start on the description.
  initialFocus: (popup, { repository }) =>
    repository
      ? (popup?.querySelector<HTMLElement>("#description") ?? null)
      : null,
});

export const delegateLoadingDialog = defineDialog<"delegate-loading">({
  title: () => "Advanced task",
  render: (dialog) => <DelegateForm dialog={dialog} />,
  initialFocus: (popup) =>
    popup?.querySelector<HTMLElement>("#description") ?? null,
});
