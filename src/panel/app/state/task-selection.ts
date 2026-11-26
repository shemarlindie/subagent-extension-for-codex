import { newTaskSessionId } from "../../features/delegation/new-task/new-task-values";
import { tasksInScope } from "./scope-reconciliation";
import { defaultSelection, selectionPatch } from "./selection";
import { availableFilter } from "./selectors";
import type { SessionStateStore } from "./session/session-state";
import { unloadedCounts } from "./task-list-read";
import type {
  PanelData,
  PersistedViewState,
  Snapshot,
  Tab,
  Task,
} from "./types";

interface TaskSelectionContext {
  snapshot(): Snapshot;
  patch(patch: Partial<Snapshot>): void;
  run(action: () => Promise<unknown>): void;
  refresh(): Promise<void>;
  /** Shares the selected task with the host's model. */
  share(): Promise<void>;
  /** The view restored from the URL, until the first task list resolves it. */
  restoredView(): PersistedViewState | undefined;
  forgetRestoredView(): void;
  /** Whether the panel is wide enough to open a task by default. */
  wide(): boolean;
  /** Keeps tasks the user just read from showing as unread. */
  settleUnread(tasks: Task[]): Task[];
  /** Follows a tab change, such as by reading the new tab's data. */
  tabShown(): void;
  session: SessionStateStore;
}

/** Decides which task and tab the panel shows, and keeps the user's choices from late reads. */
export class TaskSelection {
  /** Moves on every selection change, so reads for an earlier selection never apply. */
  private selectionGeneration = 0;
  /** Whether the user or host chose the selected task. */
  private explicitSelection = false;
  /** Whether the user left the selection, so the list doesn't choose one again. */
  private browsingList: boolean;
  /** Protects user task and tab choices from late task-list results. */
  private tabIntentRevision = 0;
  private tabIntentRevisionAtSelection = 0;
  /** Whether a task-list read changed the selection the host last saw. */
  private reconcileShare = false;

  constructor(
    private context: TaskSelectionContext,
    browsing: boolean,
  ) {
    this.browsingList = browsing;
  }

  get generation() {
    return this.selectionGeneration;
  }

  get explicit() {
    return this.explicitSelection;
  }

  get browsing() {
    return this.browsingList;
  }

  /** The tab intent revision, which view requests carry to keep a user's tab. */
  get tabIntent() {
    return this.tabIntentRevision;
  }

  private state() {
    return this.context.snapshot();
  }

  async select(id: string) {
    this.choose();
    this.context.forgetRestoredView();
    this.context.patch(selectionPatch(id, this.tabOf(id)));

    await this.context.refresh();
    await this.context.share();
  }

  back() {
    const state = this.state();
    const previousTask = state.selected ?? state.previousTask;

    this.leave(true);
    this.context.patch({ previousTask });
  }

  setTab(tab: Tab) {
    if (tab !== this.state().tab) this.tabIntentRevision++;
    this.context.patch({ tab });
    this.context.tabShown();
  }

  /** Clears the selection. `browsing` keeps the list from choosing one again. */
  leave(browsing: boolean) {
    this.explicitSelection = false;
    this.browsingList = browsing;
    ++this.selectionGeneration;
    this.tabIntentRevision++;

    this.context.patch({ ...selectionPatch(undefined), newTask: undefined });
    this.context.run(() => this.context.share());
  }

  /** Makes reads for the current selection obsolete, such as when the panel closes. */
  invalidate() {
    ++this.selectionGeneration;
  }

  /** Forgets the selection's flags when the scope changes. */
  reset() {
    this.invalidate();
    this.explicitSelection = false;
    this.browsingList = false;
  }

  /** Shares the selection after the next task-list read settles it. */
  shareAfterRead() {
    this.reconcileShare = true;
  }

  /** Shares a selection a task-list read changed, so the host sees the same task as the panel. */
  async shareIfDue() {
    if (!this.reconcileShare) return;
    await this.context.share();
    this.reconcileShare = false;
  }

  /** Lists and selects a task this panel just started. */
  selectStarted(task: Task) {
    this.choose();
    this.context.forgetRestoredView();
    const state = this.state();

    // Starting a task while composing, here or from Advanced, sends the draft.
    if (state.newTask) {
      this.context.session.remove(
        "newTask",
        newTaskSessionId(state.conversation),
      );
    }

    this.context.patch({
      tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)],
      ...selectionPatch(task.id, this.tabOf(task.id)),
      repository: task.repository,
      revision: task.revision,
    });
  }

  /**
   * The selection, tab and list controls after a task-list read: a URL-restored
   * task or browsing state first, then the current task while the list still
   * has it, then the default task. A tab the user changed since this selection
   * or read began is kept.
   */
  reconcile(tasks: Task[], tabIntentRevisionAtReadStart: number) {
    let selected = this.state().selected;

    const preserveCurrentTab =
      this.tabIntentRevision !== this.tabIntentRevisionAtSelection ||
      this.tabIntentRevision !== tabIntentRevisionAtReadStart;

    if (selected && !tasks.some((task) => task.id === selected)) {
      selected = undefined;
      this.reconcileShare = true;
      this.explicitSelection = false;
      this.selectionGeneration++;

      this.context.patch({
        events: [],
        activityFocus: undefined,
        chat: undefined,
        draft: undefined,
      });
    }

    const state = this.state();
    let tab = state.tab;
    const restored = this.context.restoredView();
    const search = restored?.search ?? state.search;

    const filter = restored
      ? availableFilter(
          { ...state, tasks, search },
          restored.filter ?? state.filter,
        )
      : state.filter;

    const restoredTask = restored?.selected
      ? tasks.find((task) => task.id === restored.selected)
      : undefined;

    if (restoredTask) {
      selected = restoredTask.id;
      this.explicitSelection = true;
      this.browsingList = false;

      if (!preserveCurrentTab) {
        tab = restored?.tab ?? this.tabOf(selected);
      }
    } else if (restored?.browsing) {
      selected = undefined;
      this.explicitSelection = false;
      this.browsingList = true;
    }

    if (!selected) {
      selected = this.defaultSelection(tasks);

      if (selected && !preserveCurrentTab) {
        tab = this.tabOf(selected);
      }
    }

    return { selected, tab, filter, search };
  }

  /** Opening data can show tasks before refresh while respecting a restored view. */
  applyOpeningTasks(
    data: PanelData,
    scope: Pick<Snapshot, "conversation" | "repository">,
  ) {
    const restored = this.context.restoredView();
    const restoredTaskView = restored?.selected || restored?.browsing;

    const hostTaskId =
      typeof data.panel_selection?.task_id === "string" && !restoredTaskView
        ? data.panel_selection.task_id
        : undefined;

    if (Array.isArray(data.tasks)) {
      const tasks = tasksInScope(data.tasks, scope);

      // Opening data carries the full list, so select now as the refresh would
      // rather than showing the empty inspector until that read returns.
      this.context.patch({
        tasks: this.context.settleUnread(tasks),
        readCompleted: unloadedCounts(data.read_completed),
        taskListLoading: false,
        ...(hostTaskId ? {} : this.fallbackSelection(tasks)),
      });
    }

    if (hostTaskId) {
      this.selectFromHost(hostTaskId, data.panel_selection?.tab);
    }
  }

  /**
   * Records a task the user or host chose, so late task-list reads keep it.
   * `newTabIntent` also starts tab tracking afresh for this selection.
   */
  private choose(newTabIntent = true) {
    ++this.selectionGeneration;
    this.explicitSelection = true;
    this.browsingList = false;
    this.tabIntentRevision++;

    if (newTabIntent) {
      this.tabIntentRevisionAtSelection = this.tabIntentRevision;
    }
  }

  private tabOf(id: string) {
    return this.context.session.get("task", id).tab;
  }

  private defaultSelection(tasks: Task[]) {
    return defaultSelection(
      tasks,
      this.state(),
      this.browsingList,
      this.context.wide(),
    );
  }

  /** Keeps a selection the list still contains; otherwise falls back to the default task. */
  private fallbackSelection(tasks: Task[]): Partial<Snapshot> {
    const current = this.state().selected;
    if (current && tasks.some((task) => task.id === current)) return {};

    if (current) {
      this.reconcileShare = true;
      this.explicitSelection = false;
      this.selectionGeneration++;
    }

    const selected = this.defaultSelection(tasks);
    if (!current && !selected) return {};

    return {
      selected,
      ...(selected ? { tab: this.tabOf(selected) } : {}),
      chatHistoryLoading: selected,
      activityHistoryLoading: selected,
    };
  }

  /** Host links respect a tab the user chose after selecting this task. */
  private selectFromHost(taskId: string, requestedTab?: string) {
    const state = this.state();

    const preserveCurrentTab =
      taskId === state.selected &&
      this.tabIntentRevision !== this.tabIntentRevisionAtSelection;

    let tab: Tab;

    if (preserveCurrentTab) {
      tab = state.tab;
    } else if (
      requestedTab === "chat" ||
      requestedTab === "changes" ||
      requestedTab === "activity" ||
      requestedTab === "details"
    ) {
      tab = requestedTab;
    } else {
      tab = this.tabOf(taskId);
    }

    this.choose(!preserveCurrentTab);
    const restored = this.context.restoredView();

    this.context.patch({
      ...selectionPatch(taskId),
      tab,
      filter: restored?.filter ?? null,
      search: restored?.search ?? "",
    });
  }
}
