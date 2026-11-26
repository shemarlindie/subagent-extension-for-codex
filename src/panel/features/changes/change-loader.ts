import { selectedTask } from "../../app/state/selectors";
import type { OpenDialogRequest, Snapshot, Task } from "../../app/state/types";
import { errorMessage } from "../../shared/utils/error-message";
import { parseFileDiff } from "./changed-files";
import { changesKey, changesStale } from "./read-changes";
import type {
  ChangeCounts,
  ChangeCountsState,
  ChangeList,
  ChangeScope,
  ChangesState,
  FileChange,
  FileDiff,
  FileDiffsState,
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
 * Reads the selected task's change totals, change list and file diffs into
 * the panel state, and removes its worktree.
 */
export class ChangeLoader {
  constructor(private context: ChangeLoaderContext) {}

  /** Diff reads run one at a time, in the order files asked for them. */
  private diffReads = Promise.resolve();

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
   * Reads the selected task's change list for `scope` (the current one by
   * default). A same-scope reload keeps the last list during the read and
   * after failure. Changing scope clears it. Diffs stay while the list's
   * revision does.
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
      const data = await this.context.tool<ChangeList>("app_get_change_list", {
        task_id: task.id,
        scope: next,
      });

      if (!live()) return;
      const diffs = this.context.snapshot().changeDiffs;
      current = { ...changes, loading: false, data };

      this.context.patch({
        changes: current,
        ...(diffs?.task === task.id &&
        diffs.scope === next &&
        diffs.revision === data.revision
          ? {}
          : {
              changeDiffs: {
                task: task.id,
                scope: next,
                revision: data.revision,
                files: new Map(),
              },
            }),
      });
    } catch (error) {
      if (!live()) return;
      current = { ...changes, loading: false, error: errorMessage(error) };
      this.context.patch({ changes: current });
    }
  }

  /**
   * Reads a listed file's diff unless it is read or being read. A failed read
   * reads again. A read the list has moved past reloads the list.
   */
  loadDiff(path: string) {
    const diffs = this.context.snapshot().changeDiffs;
    const diff = diffs?.files.get(path);
    if (!diffs || (diff && diff.status !== "error")) return Promise.resolve();
    this.setDiff(diffs, path, { status: "loading", error: diff?.error });
    this.diffReads = this.diffReads.then(() => this.readDiff(diffs, path));

    return this.diffReads;
  }

  /** The current diffs, while they still belong to `diffs`' list. */
  private currentDiffs({ task, scope, revision }: FileDiffsState) {
    const diffs = this.context.snapshot().changeDiffs;

    return !this.context.closed() &&
      diffs?.task === task &&
      diffs.scope === scope &&
      diffs.revision === revision
      ? diffs
      : undefined;
  }

  private setDiff(diffs: FileDiffsState, path: string, diff: FileDiff) {
    this.context.patch({
      changeDiffs: { ...diffs, files: new Map(diffs.files).set(path, diff) },
    });
  }

  private async readDiff(diffs: FileDiffsState, path: string) {
    // A newer list replaced this one while the read waited its turn.
    if (!this.currentDiffs(diffs)) return;
    let diff: FileDiff;

    try {
      const result = await this.context.tool<FileChange>(
        "app_get_file_change",
        {
          task_id: diffs.task,
          scope: diffs.scope,
          path,
          revision: diffs.revision,
        },
      );

      if (result.stale) {
        // The new list replaces these diffs. Should its read fail, the file
        // offers another try.
        if (
          this.currentDiffs(diffs) &&
          selectedTask(this.context.snapshot())?.id === diffs.task
        ) {
          await this.loadChanges();
        }

        diff = {
          status: "error",
          error: "The changes were updated while reading this file.",
        };
      } else {
        diff = { status: "ready", diff: parseFileDiff(result.diff) };
      }
    } catch (error) {
      diff = { status: "error", error: errorMessage(error) };
    }

    const current = this.currentDiffs(diffs);
    if (current) this.setDiff(current, path, diff);
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
