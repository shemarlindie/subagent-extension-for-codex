import {
  type KeyboardEvent,
  type SubmitEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import { readOnlyProfile } from "../../../../shared/providers/claude/permissions";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { NewTaskState } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { FormFieldError } from "../../../shared/forms/form-field-error";
import { FormFieldHint } from "../../../shared/forms/form-field-hint";
import {
  DELEGATE_FORM_FIELDS,
  workerChoices,
} from "../delegate-initial-values";
import type { DelegateValues } from "../delegate-values";
import { projectGit, workerChoice } from "../delegation";
import { WorkspaceNoteView } from "../fields/workspace-note-view";
import { useAsyncDefaults, useProfileMode } from "../use-async-defaults";
import { workspaceNote } from "../workspace-note";
import { NEW_TASK_SESSION_ID, newTaskInitialValues } from "./new-task-values";
import { NewTaskOptions } from "./options/new-task-options";

type NewTaskComposerProps = { newTask: NewTaskState };

const HINT = "Enter to start · Shift + Enter for a new line";

/** Why the composer's options are unavailable, for a failed read. */
function readFailure(errors: NewTaskState["errors"]) {
  if (errors?.settings) {
    return `Task defaults could not be loaded: ${errors.settings}`;
  }

  return `Some task options could not be loaded: ${Object.values(errors ?? {}).join(" ")}`;
}

/**
 * Starts a task from a first message, sent with Enter. The chips below the
 * message choose the project, profile, model, reasoning and permission
 * mode, and **More options** opens the Advanced task dialog with them.
 */
export function NewTaskComposer({ newTask }: NewTaskComposerProps) {
  const controller = useController();

  const scope = useSnapshot(DELEGATE_FORM_FIELDS);
  const busy = useSnapshot((state) => state.busy);

  const dialogOpen = useSnapshot((state) => Boolean(state.dialog));

  const [saved, updateSession] = useSessionState(
    "newTask",
    NEW_TASK_SESSION_ID,
    (session) => session.draft,
  );

  const savedAtMount = useRef(saved).current;
  const initialValues = newTaskInitialValues(newTask, scope);

  const form = useForm<DelegateValues>({
    defaultValues: { ...initialValues, ...savedAtMount },
  });

  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useAsyncDefaults(form, initialValues, savedAtMount);
  useProfileMode(form, initialValues.permission_mode, savedAtMount);

  // Keep the message and changed options in session memory until sent.
  useEffect(() => {
    const subscription = form.watch((_values, { name }) => {
      if (!name) return;
      const field = name.split(".")[0] as keyof DelegateValues;

      updateSession({
        draft: {
          ...controller.session.get("newTask", NEW_TASK_SESSION_ID).draft,
          [field]: form.getValues(field),
        },
      });
    });

    return () => subscription.unsubscribe();
  }, [form, controller, updateSession]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const [description, chosenRepository, worker] = useWatch({
    control: form.control,
    name: ["description", "repository", "worker"],
  });

  // A scoped panel targets its project; the chip only shows for All projects.
  const repository = scope.repository ?? chosenRepository;

  const { statuses, errors } = newTask;

  const readsReady = Object.values(statuses).every(
    (status) => status === "ready",
  );

  const failed = Object.values(statuses).some((status) => status === "error");

  const readiness = scope.workers.find(
    (item) => item.provider === workerChoice(worker).provider,
  )?.readiness;

  const canSubmit =
    readsReady &&
    !busy &&
    Boolean(description.trim()) &&
    Boolean(repository) &&
    workerChoices(scope.workers).includes(worker) &&
    readiness?.ready !== false;

  const submit = form.handleSubmit(async (values) => {
    const failure = await controller.newTasks.start(
      {
        ...values,
        repository,
        description: values.description.trim(),
        // Another project's checkout starts from its own HEAD.
        revision: repository === scope.repository ? values.revision : "HEAD",
      },
      box.current?.offsetHeight,
    );

    // On success the composer closes and the controller clears its draft.
    if (failure) setError(failure);
  });

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) void submit(event);
  }

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) void submit();
    } else if (event.key === "Escape" && !description) {
      event.preventDefault();
      controller.back();
    }
  };

  const advanced = () => {
    const values = { ...form.getValues(), repository };

    // Pending defaults are placeholders, not saved choices. Let Advanced
    // fill them from its reads instead of pinning a blank worker or effort.
    const draft = {
      description: values.description,
      model: values.model,
      ...(values.repository ? { repository: values.repository } : {}),
      ...(values.worker ? { worker: values.worker } : {}),
      ...(values.reasoning_effort
        ? { reasoning_effort: values.reasoning_effort }
        : {}),
      ...((statuses.settings === "ready" && statuses.workers === "ready") ||
      "permission_mode" in savedAtMount
        ? { permission_mode: values.permission_mode }
        : {}),
    };

    controller.run(() =>
      controller.delegate(values.worker || undefined, draft),
    );
  };

  const { ref: messageRef, ...messageField } = form.register("description");

  const setInput = (element: HTMLTextAreaElement | null) => {
    input.current = element;
    messageRef(element);
  };

  return (
    <FormProvider {...form}>
      {/* Chat's composer layout, so sending leaves the box where Chat's will be. */}
      <form
        className="chat-composer new-task-composer"
        noValidate
        aria-busy={busy || undefined}
        onSubmit={handleSubmit}
      >
        <div className="chat-composer-body">
          <div className="chat-composer-input-row">
            {/* Holds the place of Chat's hide-composer caret. */}
            <span className="chat-composer-gutter" aria-hidden="true" />
            <div ref={box} className="chat-composer-box new-task-box">
              <textarea
                id="new-task-message"
                aria-label="Task message"
                aria-describedby="new-task-hint"
                rows={2}
                maxLength={20000}
                placeholder="Describe the task."
                disabled={busy}
                {...messageField}
                ref={setInput}
                onKeyDown={keys}
              />
              <div className="new-task-box-footer">
                <NewTaskOptions newTask={newTask} state={scope} />
                <div className="chat-composer-actions">
                  <Button
                    variant="text"
                    className="new-task-more"
                    disabled={busy || dialogOpen}
                    onClick={advanced}
                  >
                    More options…
                  </Button>
                  <TooltipWrapper label="Start task (Enter)">
                    <Button
                      type="submit"
                      variant="primary"
                      className="chat-icon-button"
                      aria-label="Start task"
                      disabled={!canSubmit}
                    >
                      <Icon name="enter" size={12} />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            </div>
          </div>
          <div className="chat-composer-meta chat-composer-field-feedback">
            <FormFieldHint id="new-task-hint" message={HINT} />
          </div>
          <div className="chat-composer-field-feedback">
            <WorkspaceNoteView
              note={workspaceNote({
                git: projectGit(scope, repository),
                savedStrategy: newTask.defaults?.task.workspace_strategy,
                readOnly: readOnlyProfile(workerChoice(worker).profile ?? ""),
              })}
            />
          </div>
        </div>
        {failed && (
          <div
            className="form-error chat-error chat-composer-field-feedback new-task-error"
            role="alert"
          >
            <span>{readFailure(errors)}</span>
            <Button variant="text" onClick={() => controller.newTasks.retry()}>
              Retry loading
            </Button>
          </div>
        )}
        <FormFieldError
          className="chat-error chat-composer-field-feedback"
          message={
            readiness?.ready === false
              ? readiness.message
              : (error ?? form.formState.errors.root?.settings?.message)
          }
        />
      </form>
    </FormProvider>
  );
}
