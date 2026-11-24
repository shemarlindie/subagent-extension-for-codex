import { useCallback, useEffect, useRef, type SubmitEvent } from "react";
import { useWatch } from "react-hook-form";

import { readOnlyProfile } from "../../../shared/providers/claude/permissions";
import { useController, useSnapshot } from "../../app/state/controller-context";
import type { Snapshot, Task } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { FormFieldError } from "../../shared/forms/form-field-error";
import { FormFooter } from "../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../shared/forms/use-persisted-dialog-form";
import { runsInPlace } from "../projects/selectors";
import {
  DELEGATE_FORM_FIELDS,
  delegateInitialValues,
  delegateReads,
  delegateTarget,
  workerChoices,
  type DelegateFormDialog,
} from "./delegate-initial-values";
import type { DelegateValues } from "./delegate-values";
import {
  projectGit,
  taskProjects,
  THREAD_TASK_NOTE,
  workerChoice,
} from "./delegation";
import { ApprovalField } from "./fields/approval-field";
import { BudgetFields } from "./fields/budget-fields";
import { DescriptionField } from "./fields/description-field";
import { ModelFields } from "./fields/model-fields";
import { ProjectField } from "./fields/project-field";
import { RevisionField } from "./fields/revision-field";
import { WorkerField } from "./fields/worker-field";
import { WorkspaceField } from "./fields/workspace-field";
import { WorkspaceNoteView } from "./fields/workspace-note-view";
import { newTaskSessionId } from "./new-task/new-task-values";
import { startTaskArguments } from "./start-task";
import { useAsyncDefaults, useProfileMode } from "./use-async-defaults";
import { useProjectWorkers } from "./use-project-workers";
import { workspaceNote } from "./workspace-note";

interface DelegateFormProps {
  dialog: DelegateFormDialog;
}

function DelegateForm({ dialog }: DelegateFormProps) {
  const controller = useController();

  const scope = useSnapshot(DELEGATE_FORM_FIELDS);

  const { busy, conversation } = useSnapshot(["busy", "conversation"]);

  const { loading, statuses, errors, message, defaults } =
    delegateReads(dialog);

  const persistedDraft = useRef(controller.getDialogDraft("delegate") ?? {});
  const choices = workerChoices(scope.workers);

  const { repository: resolvedRepository, revision: resolvedRevision } =
    delegateTarget(dialog, scope);

  const initialValues = delegateInitialValues({
    dialog,
    scope,
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

  // Models and policy follow a listed project or the panel's own folder. A
  // path being typed reads nothing until it matches one.
  const listed =
    repository === scope.repository ||
    scope.projects.some((project) => project.repository === repository);

  const project = useProjectWorkers(
    listed ? repository : undefined,
    scope.workers,
  );

  const requiredReadsReady =
    statuses.context === "ready" &&
    statuses.settings === "ready" &&
    statuses.projects === "ready" &&
    statuses.workers === "ready";

  const hasWorkers = choices.length > 0;

  const selectedWorkerReady =
    scope.workers.find(
      (worker) => worker.provider === workerChoice(selectedWorker).provider,
    )?.readiness?.ready !== false;

  const canSubmit =
    requiredReadsReady &&
    hasWorkers &&
    choices.includes(selectedWorker) &&
    Boolean(selectedWorker) &&
    Boolean(repository.trim()) &&
    selectedWorkerReady;

  const failedReads = (
    Object.keys(statuses) as (keyof typeof statuses)[]
  ).filter((resource) => statuses[resource] === "error");

  const submit = form.handleSubmit((values) =>
    controller.submit(async () => {
      await controller.addChatProjectForTask(values.repository);

      const files =
        controller.getSnapshot().newTask &&
        controller.session.get("newTask", newTaskSessionId(conversation)).files;

      return controller.tool<Task>("start_task", {
        ...startTaskArguments(
          values,
          scope.workers,
          conversation,
          projectGit(scope, values.repository),
        ),
        ...(files?.length
          ? { attachments: files.map((file) => file.upload) }
          : {}),
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

  // Fields are memoized, so this form's renders reach only the fields whose
  // props change. They take the form as a prop, since the form context would
  // render them on every form state change, such as the form becoming ready.
  const browse = useCallback(
    () =>
      controller.run(async () => {
        const repository = await controller.browseTaskProject();

        // Keep selection in this draft; changing panel scope would discard it.
        if (repository) {
          form.setValue("repository", repository, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
      }),
    [controller, form],
  );

  // A project with no commit has one valid workspace. Leaving it restores the
  // saved default, the value the form would have started with.
  const git = projectGit(scope, repository);
  const inPlace = runsInPlace(git);
  const savedStrategy = defaults.task.workspace_strategy;
  const wasInPlace = useRef(false);

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

  return (
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
        form={form}
        projects={taskProjects(scope)}
        loading={statuses.projects === "loading"}
        contextLoading={statuses.context === "loading"}
        error={errors?.projects}
        contextError={errors?.context}
        disabled={
          busy ||
          statuses.projects !== "ready" ||
          statuses.context === "loading"
        }
        browseDisabled={busy || loading}
        onBrowse={browse}
        allowParent={scope.projects.some(
          (project) => project.kind === "parent",
        )}
      />
      <DescriptionField form={form} />
      <div className={revisionShown ? "two task-workspace-fields" : undefined}>
        <div>
          <WorkspaceField
            form={form}
            settingsReady={statuses.settings === "ready"}
            settingsLoading={statuses.settings === "loading"}
            inPlace={inPlace}
          />
        </div>
        {revisionShown && (
          <div>
            <RevisionField
              form={form}
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
          readOnly: readOnlyProfile(workerChoice(selectedWorker).profile ?? ""),
        })}
      />
      <WorkerField
        form={form}
        workers={scope.workers}
        loading={
          statuses.workers === "loading" ||
          (statuses.settings === "loading" && !selectedWorker)
        }
        error={errors?.workers}
        disabled={statuses.workers !== "ready" || statuses.settings !== "ready"}
      />
      <ModelFields
        form={form}
        defaults={defaults}
        workers={project.workers}
        settingsReady={statuses.settings === "ready"}
        workersReady={statuses.workers === "ready"}
        settingsLoading={statuses.settings === "loading"}
        workersLoading={statuses.workers === "loading" || project.pending}
      />
      <ApprovalField
        form={form}
        workers={project.workers}
        defaults={defaults}
        disabled={statuses.workers !== "ready" || statuses.settings !== "ready"}
        loading={
          statuses.workers === "loading" ||
          statuses.settings === "loading" ||
          project.pending
        }
      />
      <BudgetFields
        form={form}
        workers={scope.workers}
        settingsReady={statuses.settings === "ready"}
        workersReady={statuses.workers === "ready"}
        settingsLoading={statuses.settings === "loading"}
      />
      <FormFooter label="Start task" disabled={!canSubmit} />
    </form>
  );
}

const threadSubtitle = (_dialog: unknown, { conversation }: Snapshot) =>
  conversation ? THREAD_TASK_NOTE : undefined;

export const delegateDialog = defineDialog<"delegate">({
  title: () => "Advanced task",
  subtitle: threadSubtitle,
  render: (dialog) => <DelegateForm dialog={dialog} />,
  // With a known repository the project is settled, so start on the description.
  initialFocus: (popup, { repository }) =>
    repository
      ? (popup?.querySelector<HTMLElement>("#description") ?? null)
      : null,
});

export const delegateLoadingDialog = defineDialog<"delegate-loading">({
  title: () => "Advanced task",
  subtitle: threadSubtitle,
  render: (dialog) => <DelegateForm dialog={dialog} />,
  initialFocus: (popup) =>
    popup?.querySelector<HTMLElement>("#description") ?? null,
});
