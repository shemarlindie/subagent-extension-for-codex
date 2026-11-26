import { selectedTask } from "../../app/state/selectors";
import type { OpenDialogRequest, Snapshot, Task } from "../../app/state/types";
import { errorMessage } from "../../shared/utils/error-message";
import { changesKey, changesStale, readChanges } from "./read-changes";
import type {
  ChangeCounts,
  ChangeCountsState,
  Changes,
  ChangeScope,
  ChangesState,
  WorktreeRemoval,
} from "./types";

interface ChangeLoaderContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  open(dialog: OpenDialogRequest): void;
  refresh(): Promise<void>;
}

/**
 * Reads the selected task's change totals and changes into the panel state,
 * and removes its worktree.
 */
export class ChangeLoader {
  constructor(private context: ChangeLoaderContext) {}

  /** Reads the selected task's change totals when its status or turn has moved on. */
  async loadCountsIfStale() {
    const state = this.context.snapshot();
    const task = selectedTask(state);

    if (task && changesStale(state.changeCounts, task)) {
      await this.loadCounts();
    }
  }

  /** Reads the selected task's full changes while the Changes tab is open. */
  async loadChangesIfStale() {
    const state = this.context.snapshot();
    const task = selectedTask(state);

    if (task && state.tab === "changes" && changesStale(state.changes, task)) {
      await this.loadChanges();
    }
  }

  /**
   * Reads the selected task's change totals for its tab count and Details: the
   * counts alone, so the file list and diff stay on the service until Changes
   * opens. A reload keeps the last totals during the read and after failure.
   */
  async loadCounts() {
    const state = this.context.snapshot();
    const task = selectedTask(state);

    if (!task || this.context.closed()) return;

    const previous =
      state.changeCounts?.task === task.id ? state.changeCounts : undefined;

    const counts: ChangeCountsState = {
      task: task.id,
      key: changesKey(task),
      loading: true,
      data: previous?.data,
    };

    let current = counts;
    this.context.patch({ changeCounts: counts });

    // A newer read, or another task, replaces this one.
    const live = () =>
      !this.context.closed() &&
      this.context.snapshot().changeCounts === current;

    try {
      const data = await this.context.tool<ChangeCounts>(
        "app_get_change_counts",
        { task_id: task.id },
      );

      if (live()) {
        current = { ...counts, loading: false, data };
        this.context.patch({ changeCounts: current });
      }
    } catch (error) {
      if (!live()) return;
      current = { ...counts, loading: false, error: errorMessage(error) };
      this.context.patch({ changeCounts: current });
    }
  }

  /**
   * Reads the selected task's changes, every page, for `scope` (the current
   * one by default). A same-scope reload keeps the last result during the
   * read and after failure; changing scope clears it.
   */
  async loadChanges(scope?: ChangeScope) {
    const state = this.context.snapshot();
    const task = selectedTask(state);

    if (!task || this.context.closed()) return;

    const previous =
      state.changes?.task === task.id ? state.changes : undefined;

    const next = scope ?? previous?.scope ?? "task";

    const changes: ChangesState = {
      task: task.id,
      scope: next,
      key: changesKey(task),
      loading: true,
      data: previous?.scope === next ? previous.data : undefined,
    };

    let current = changes;
    this.context.patch({ changes });

    // A newer read, or another task, replaces this one.
    const live = () =>
      !this.context.closed() && this.context.snapshot().changes === current;

    try {
      const data = await readChanges(
        task.id,
        changes.scope,
        (args) => this.context.tool<Changes>("get_changes", args),
        live,
      );

      if (data && live()) {
        current = { ...changes, loading: false, data };
        this.context.patch({ changes: current });
      }
    } catch (error) {
      if (!live()) return;
      current = { ...changes, loading: false, error: errorMessage(error) };
      this.context.patch({ changes: current });
    }
  }

  /**
   * Removes a task's worktree and keeps its branch. A worktree with
   * uncommitted changes is kept; a dialog lists them and asks first.
   */
  async removeWorktree(task: Task) {
    const state = this.context.snapshot();
    if (state.busy || state.dialog || this.context.closed()) return;
    this.context.patch({ busy: true });
    let result: WorktreeRemoval;

    try {
      result = await this.context.tool<WorktreeRemoval>("app_remove_worktree", {
        task_id: task.id,
      });
    } finally {
      this.context.patch({ busy: false });
    }

    if (result.status === "uncommitted") {
      this.context.open({
        kind: "worktree",
        action: "remove",
        task,
        files: result.files,
      });

      return;
    }

    // The Changes tab and the tab count read the removed worktree at once.
    await this.loadChanges();
    await this.loadCounts();
    await this.context.refresh();
  }
}
