import {
  applyDelegateRead,
  type DelegateReadContext,
  type DelegateReadResult,
  initialDelegateStatuses,
  retryDelegateStatuses,
  startDelegateReads,
} from "../../../app/state/delegate-reads";
import type {
  DelegateDialogRead,
  DialogReadStatus,
  NewTaskState,
  Snapshot,
  Task,
} from "../../../app/state/types";
import { errorMessage } from "../../../shared/utils/error-message";
import type { DelegateValues } from "../delegate-values";
import { startTaskArguments } from "../start-task";

interface NewTaskLoaderContext extends DelegateReadContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  addChatProjectForTask(repository: string): Promise<void>;
  /** Clears the task selection, closing any open composer too. */
  leaveSelection(): void;
  /** Selects a task the composer just created. */
  created(task: Task): Promise<void>;
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

  /** Records the panel context read, which the controller's refresh owns. */
  contextRead(status: DialogReadStatus, error?: unknown) {
    const current = this.context.snapshot().newTask;

    if (current && current.statuses.context !== "ready") {
      this.update(current.request, "context", status, undefined, error);
    }
  }

  /**
   * Starts the task; returns an error message for the composer to show.
   * The composer closes and the task is selected once it starts.
   */
  async start(values: DelegateValues): Promise<string | undefined> {
    const state = this.context.snapshot(),
      newTask = state.newTask;

    if (!newTask || state.busy || this.context.closed()) return undefined;

    this.context.patch({ busy: true });
    let task: Task;

    try {
      await this.context.addChatProjectForTask(values.repository);

      task = await this.context.tool<Task>(
        "start_agent_task",
        startTaskArguments(values, state.workers, state.conversation),
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

    await this.context.created(task);

    return undefined;
  }

  private load({ request, statuses }: NewTaskState) {
    startDelegateReads(this.context, statuses, (...update) =>
      this.update(request, ...update),
    );
  }
}
