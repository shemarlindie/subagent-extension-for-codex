import {
  settingAt,
  withSetting,
} from "../../../../shared/settings/settings-schema";
import { titleCase } from "../../../../shared/text";
import type { TaskSessionState } from "../../../app/state/session/session-state";
import type {
  DelegateDialogRead,
  DialogReadStatus,
  NewTaskState,
  Snapshot,
  Task,
} from "../../../app/state/types";
import { errorMessage } from "../../../shared/utils/error-message";
import {
  applyDelegateRead,
  type DelegateReadContext,
  type DelegateReadResult,
  initialDelegateStatuses,
  retryDelegateStatuses,
  startDelegateReads,
} from "../delegate-reads";
import type { DelegateValues } from "../delegate-values";
import { projectGit, workerChoice } from "../delegation";
import { startTaskArguments } from "../start-task";

interface NewTaskLoaderContext extends DelegateReadContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  addChatProjectForTask(repository: string): Promise<void>;
  /** Clears the task selection, closing any open composer too. */
  leaveSelection(): void;
  /** Selects a task the composer just created, with Chat's arrival state. */
  created(task: Task, arrival: Partial<TaskSessionState>): Promise<void>;
  /** Retries the panel context read through the next refresh. */
  refresh(): void;
}

/**
 * The composer after a scope change `patch`: it follows global project
 * changes, and a chat scope closes it.
 */
export function rescopedNewTask(
  { newTask, conversation }: Snapshot,
  patch: Partial<Snapshot>,
  scope: number,
) {
  const chat = "conversation" in patch ? patch.conversation : conversation;

  return newTask && !chat ? { ...newTask, scope } : undefined;
}

/**
 * Owns the new-task composer's state: the reads its options need, retries,
 * and starting the task. Each opening or retry gets a request number, so a
 * late read for an older one is dropped.
 */
export class NewTaskLoader {
  private request = 0;

  constructor(private context: NewTaskLoaderContext) {}

  /** Shows the composer in place of the selected task and starts its reads. */
  open() {
    const current = this.context.snapshot();
    if (current.dialog || current.busy || current.newTask) return;

    this.context.leaveSelection();
    const state = this.context.snapshot();

    const newTask: NewTaskState = {
      scope: state.scopeVersion,
      request: ++this.request,
      statuses: initialDelegateStatuses(state),
    };

    this.context.patch({ newTask });
    this.load(newTask);
  }

  /** Reopens a URL-restored composer after its initial scope has resolved. */
  restore(composing?: boolean) {
    if (composing) this.open();
  }

  retry() {
    const newTask = this.context.snapshot().newTask;
    if (!newTask) return;

    const retryContext = newTask.statuses.context === "error",
      retry = { ...retryDelegateStatuses(newTask), request: ++this.request };

    this.context.patch({ newTask: retry });
    this.load(retry);
    if (retryContext) this.context.refresh();
  }

  /** Records one read for the open composer. */
  update(
    request: number,
    resource: DelegateDialogRead,
    status: DialogReadStatus,
    result?: DelegateReadResult,
    error?: unknown,
  ) {
    const current = this.context.snapshot().newTask;

    if (this.context.closed() || current?.request !== request) return;

    this.context.patch({
      ...result?.snapshot,
      newTask: applyDelegateRead(current, resource, status, result, error),
    });
  }

  /** Hands a project added from the project chip to the open composer. */
  projectAdded(repository: string) {
    const newTask = this.context.snapshot().newTask;

    if (newTask) {
      this.context.patch({ newTask: { ...newTask, addedProject: repository } });
    }
  }

  /** Records the panel context read, which the controller's refresh owns. */
  contextRead(status: DialogReadStatus, error?: unknown) {
    const current = this.context.snapshot().newTask;

    if (current && current.statuses.context !== "ready") {
      this.update(current.request, "context", status, undefined, error);
    }
  }

  /**
   * Starts the task; returns an error message for the composer to show.
   * The composer closes and the task is selected once it starts;
   * `composerHeight` lets Chat's composer ease in from the composer's box.
   */
  async start(
    values: DelegateValues,
    composerHeight?: number,
  ): Promise<string | undefined> {
    const state = this.context.snapshot(),
      newTask = state.newTask;

    if (!newTask || state.busy || this.context.closed()) return undefined;

    this.context.patch({ busy: true });
    let task: Task;

    try {
      await this.context.addChatProjectForTask(values.repository);

      task = await this.context.tool<Task>(
        "start_task",
        startTaskArguments(
          values,
          state.workers,
          state.conversation,
          projectGit(state, values.repository),
        ),
      );
    } catch (error) {
      return errorMessage(error);
    } finally {
      this.context.patch({ busy: false });
    }

    if (this.context.closed()) return undefined;

    // The composer follows global project changes, so compare its opening scope.
    if (this.context.snapshot().scopeVersion !== newTask.scope) {
      return "The project or conversation changed while the task was starting. Find it in its original scope.";
    }

    // Chat's composer eases down from this box's height and takes over focus.
    await this.context.created(task, {
      composerArrival: composerHeight,
      composerFocus: true,
    });

    return undefined;
  }

  /**
   * Saves a model or reasoning choice as the profile's default setting, so
   * choosing the profile again starts with it. Returns an error message.
   */
  async saveProfileSetting(
    worker: string,
    field: "model" | "reasoning_effort",
    value: string,
  ): Promise<string | undefined> {
    const { profile } = workerChoice(worker);
    if (!profile) return undefined;

    const path = `models.profiles.${profile}.${field}`;

    // Keeps the composer's loaded defaults in step, while it stays open.
    const setDefault = (next: unknown, replacing: unknown) => {
      const newTask = this.context.snapshot().newTask;

      if (
        !newTask?.defaults ||
        settingAt(newTask.defaults, path) !== replacing
      ) {
        return;
      }

      const defaults = withSetting(newTask.defaults, path, next);
      this.context.patch({ newTask: { ...newTask, defaults } });
    };

    const previous = settingAt(this.context.snapshot().newTask?.defaults, path);
    setDefault(value, previous);

    try {
      await this.context.tool("update_settings", {
        set: withSetting({}, path, value),
      });
    } catch (error) {
      // Restore the loaded default unless a later choice replaced it.
      setDefault(previous, value);

      return `The ${titleCase(profile)} profile's default could not be saved: ${errorMessage(error)}`;
    }

    return undefined;
  }

  private load({ request, statuses }: NewTaskState) {
    startDelegateReads(this.context, statuses, (...update) =>
      this.update(request, ...update),
    );
  }
}
