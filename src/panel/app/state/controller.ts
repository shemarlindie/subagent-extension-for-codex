import { panelLoadOperation } from "../../../shared/tasks/panel-timing";
import { ChangeLoader } from "../../features/changes/change-loader";
import type {
  ChangeScope,
  WorktreeRemoval,
} from "../../features/changes/types";
import {
  NewTaskLoader,
  rescopedNewTask,
} from "../../features/delegation/new-task/new-task-loader";
import { NEW_TASK_SESSION_ID } from "../../features/delegation/new-task/new-task-values";
import {
  renamedProject,
  withoutProject,
} from "../../features/projects/project-list";
import {
  mutateProject,
  type ProjectRemoval,
} from "../../features/projects/project-mutation";
import { projectUndoSteps } from "../../features/projects/project-undo";
import { DraftFollower } from "../../features/tasks/chat/drafts/draft-follower";
import {
  handoffMessage,
  type HandoffTarget,
} from "../../features/tasks/controls/handoff-message";
import { TaskActions } from "../../features/tasks/controls/task-actions";
import { TimingReporter } from "../../features/tasks/controls/timing-reporter";
import { PendingUpdateTracker } from "../../features/tasks/pending-updates/pending-update-tracker";
import { TaskDetailLoader } from "../../features/tasks/task-detail-loader";
import { errorMessage } from "../../shared/utils/error-message";
import { sharedRequest } from "../../shared/utils/shared-request";
import {
  canNavigate,
  DEFAULT_PAGE,
  isSettingsPageDialog,
  type PageId,
  PAGES,
} from "../navigation/pages";
import { CONNECTION, type ConnectionLabel } from "./connection";
import { DialogLoader } from "./dialog-loader";
import { initialState } from "./initial-state";
import { browserEnvironment, type PanelEnvironment } from "./panel-environment";
import {
  olderRevision,
  type UpdateRead,
  viewArgs,
  type ViewRead,
  type ViewRequest,
} from "./panel-view";
import { PersistedDialogs } from "./persistence/persisted-dialogs";
import { persistView } from "./persistence/persisted-view";
import { RevisionTrigger } from "./revision-trigger";
import {
  parsePanelScope,
  projectRemovalReset,
  tasksInScope,
} from "./scope-reconciliation";
import { defaultSelection, selectionPatch } from "./selection";
import { availableFilter, selectedTask, showsReadCompleted } from "./selectors";
import { SessionStateStore } from "./session/session-state";
import { TaskArrivals, taskArrivalTarget } from "./task-arrivals";
import { lacksNewSelection, unloadedCounts } from "./task-list-read";
import type {
  DialogState,
  Filter,
  OpenDialogRequest,
  PanelData,
  PersistedDialog,
  PersistedDialogDraft,
  PersistedViewState,
  Project,
  Snapshot,
  Tab,
  Task,
  TaskList,
  Transport,
  UiStatePersistence,
  Worker,
} from "./types";
import { UndoHistory } from "./undo-history";
import { UpdateFollower } from "./update-follower";

/** How long a quiet panel waits before refreshing anyway, for writes the service can't announce. */
const FALLBACK_REFRESH_MS = 30_000;

/** Ends the first-read placeholders when the panel can't read tasks. */
const READS_STOPPED = {
  taskListLoading: false,
  chatHistoryLoading: undefined,
  activityHistoryLoading: undefined,
} satisfies Partial<Snapshot>;

/** How long a ready worker list is reused before it is read again. */
const WORKERS_FRESH_MS = 60 * 60_000;

/** Owns async lifecycles and reviewed scope; components own presentation and drafts. */
export class Controller {
  private state: Snapshot;
  private stateContext = {
    snapshot: () => this.state,
    closed: () => this.disposed,
    patch: (patch: Partial<Snapshot>) => this.patch(patch),
    tool: <T>(name: string, args?: Record<string, unknown>) =>
      this.tool<T>(name, args),
  };

  readonly timing: TimingReporter = new TimingReporter(this.stateContext);

  private draftFollower = new DraftFollower({
    ...this.stateContext,
    hidden: () => this.environment.hidden(),
    streamsDrafts: () => this.transport.streamsDrafts,
    run: (action) => this.run(action),
    refresh: () => this.refresh(),
  });

  private detailLoader = new TaskDetailLoader({
    ...this.stateContext,
    generation: () => this.generation,
    setTab: (tab) => this.setTab(tab),
    drafts: this.draftFollower,
    timing: this.timing,
  });

  private revisions = new RevisionTrigger({
    ...this.stateContext,
    hidden: () => this.environment.hidden(),
    busy: () => this.state.busy,
    refresh: () => this.run(() => this.refresh()),
  });

  private updates = new UpdateFollower({
    ...this.stateContext,
    status: (text) => this.showConnection(text),
    // A hidden panel would drop the view, so it waits for the revision alone.
    viewRequest: () =>
      this.state.scopeKnown && !this.environment.hidden()
        ? this.viewRequest()
        : undefined,
    receive: (read, request) => this.receive(read, request),
    draftTarget: () => this.draftFollower.target(),
    receiveDraft: (target, read) => this.draftFollower.receive(target, read),
  });

  private stopVisibility?: () => void;
  /** Whether the transport has reported its connection status. */
  private transportStatus = false;

  private listeners = new Set<() => void>();
  readonly session: SessionStateStore;
  private disposed = false;
  private started = false;
  private refreshing = false;
  private rerun = false;
  private generation = 0;
  private projectGeneration = 0;
  /** The revision of the last view the panel applied. */
  private viewRevision?: string;
  /** Protects user task and tab choices from late task-list results. */
  private tabIntentRevision = 0;
  private tabIntentRevisionAtSelection = 0;
  private reconcileShare = false;
  private browsing = false;
  private explicitSelection = false;
  private arrivals = new TaskArrivals();
  private restoredView?: PersistedViewState;
  private dialogs: PersistedDialogs;
  private viewStateReady = false;
  private timer?: ReturnType<typeof setTimeout>;
  /** When workers were last read, so a CLI that breaks mid-session still shows. */
  private workersReadAt = 0;
  private readProjects = sharedRequest(() =>
    this.tool<Project[]>("list_projects"),
  );

  private readWorkers = sharedRequest(() =>
    this.tool<Worker[]>("list_workers"),
  );

  /** Shared reads for the new-task composer and Advanced task dialog. */
  private formContext = {
    ...this.stateContext,
    readProjects: () => this.readProjects(),
    readWorkers: async () => {
      const workers = await this.readWorkers();
      this.workersReadAt = Date.now();

      return workers;
    },
    refresh: () => this.run(() => this.refresh()),
  };

  private dialogLoader = new DialogLoader({
    ...this.formContext,
    seedDraft: (dialog, draft) => this.dialogs.seed(dialog, draft, false),
    explicitSelection: () => this.explicitSelection,
  });

  /** The new-task composer: opening, its reads and starting the task. */
  readonly newTasks = new NewTaskLoader({
    ...this.formContext,
    addChatProjectForTask: (repository) =>
      this.addChatProjectForTask(repository),
    leaveSelection: () => this.leaveSelection(false),
    // Shows the started task on its Chat tab.
    created: async (task, arrival) => {
      this.session.update("task", task.id, arrival);
      this.selectStarted(task);
      await this.refresh().catch(this.report);
      await this.share().catch(this.report);
    },
  });

  /** The user's reversible changes, for undo and redo. */
  readonly undo = new UndoHistory(this.stateContext);
  private projectUndo = projectUndoSteps(this.stateContext);

  readonly taskActions = new TaskActions({
    timing: this.timing,
    ...this.stateContext,
    refresh: () => this.refresh(),
    report: (error) => this.report(error),
    forgetQuestion: (requestId) => this.session.remove("question", requestId),
    leaveSelection: () => this.leaveSelection(true),
    select: (id) => this.select(id),
    undo: this.undo,
  });

  private changeLoader = new ChangeLoader(this.stateContext);
  readonly pendingUpdates = new PendingUpdateTracker(this.stateContext);

  constructor(
    readonly transport: Transport,
    private environment: PanelEnvironment = browserEnvironment,
    private viewState?: UiStatePersistence,
  ) {
    this.session = new SessionStateStore(viewState?.composerDrafts);
    this.restoredView = viewState?.initial.view ?? {};

    this.dialogs = new PersistedDialogs(
      {
        ...this.stateContext,
        changed: () => {
          if (this.viewStateReady) this.saveViewState();
        },
        save: () => this.saveViewState(),
        show: (dialog) => this.patch({ dialog, formError: "" }),
        openSettings: () => this.dialogLoader.openSettings(),
        openDelegate: (...args) => this.dialogLoader.openDelegate(...args),
      },
      viewState?.initial,
    );

    const initial = initialState();

    this.browsing = this.restoredView.browsing === true;

    const restoredSelection = this.browsing
      ? undefined
      : this.restoredView.selected;

    // Seed URL-backed controls before the first render, then validate task data on load.
    this.state = {
      ...initial,
      page:
        this.dialogs.latest()?.kind === "settings"
          ? "settings"
          : (this.restoredView.page ?? initial.page),
      filter: this.restoredView.filter ?? initial.filter,
      search: this.restoredView.search ?? initial.search,
      tab: this.restoredView.tab ?? initial.tab,
      selected: restoredSelection,
      chatHistoryLoading: restoredSelection,
      activityHistoryLoading: restoredSelection,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  private patch(patch: Partial<Snapshot>) {
    if (this.disposed) return;

    if (patch.dialog && patch.dialog !== this.state.dialog) {
      this.dialogs.shown(this.state.dialog, patch.dialog);
    }

    const wasBusy = this.state.busy;
    this.state = { ...this.state, ...patch };

    if (this.state.selected) {
      this.session.update("task", this.state.selected, { tab: this.state.tab });
    }

    this.listeners.forEach((listener) => listener());
    if (this.viewStateReady) this.saveViewState();
    if (wasBusy && !this.state.busy) this.revisions.resume();
  }

  private saveViewState() {
    this.viewState?.save({
      view: persistView(this.state, this.browsing),
      ...this.dialogs.saved(),
    });
  }

  getDialogDraft(kind: PersistedDialog["kind"]) {
    return this.dialogs.draft(kind);
  }

  getLastSettingsSection() {
    return this.dialogs.lastSettingsSection();
  }

  saveSettingsSection(section: string) {
    this.dialogs.saveSettingsSection(section);
  }

  saveDialogDraft(kind: PersistedDialog["kind"], draft: PersistedDialogDraft) {
    this.dialogs.saveDraft(kind, draft);
  }

  saveDialogField(kind: PersistedDialog["kind"], name: string, value: unknown) {
    this.dialogs.saveField(kind, name, value);
  }

  private closeDialog() {
    this.dialogs.pop();
    this.patch({ dialog: undefined, formError: "" });
    this.dialogs.restore(this.state.tasks, this.state.scopeVersion);
  }

  private defaultSelection = (tasks: Task[]) =>
    defaultSelection(tasks, this.state, this.browsing, this.environment.wide());

  /** Keeps a selection the list still contains; otherwise falls back to the default task. */
  private fallbackSelection(tasks: Task[]): Partial<Snapshot> {
    const current = this.state.selected;
    if (current && tasks.some((task) => task.id === current)) return {};

    if (current) {
      this.reconcileShare = true;
      this.explicitSelection = false;
      this.generation++;
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

  report = (error: unknown) => {
    if (!this.disposed) this.patch({ error: errorMessage(error) });
  };

  run = (action: () => Promise<unknown>) => {
    void action().catch(this.report);
  };

  /** Adapts an async event handler, such as a form submit, through `run`. */
  handle =
    <Args extends unknown[]>(action: (...args: Args) => Promise<unknown>) =>
    (...args: Args) =>
      this.run(() => action(...args));

  /** Shows the transport's connection status, which refreshes then leave alone. */
  private showConnection(connection: ConnectionLabel) {
    this.transportStatus = true;
    if (connection !== this.state.connection) this.patch({ connection });
  }

  showHostRequired() {
    this.patch({ connection: CONNECTION.hostRequired, ...READS_STOPPED });
  }

  async start() {
    if (this.started || this.disposed) return;
    this.started = true;

    try {
      await this.transport.connect({
        scope: (data) => this.applyScope(data),
        status: (connection) => this.showConnection(connection),
        login: () => this.patch({ loginRequired: true, ...READS_STOPPED }),
        host: (host) => this.patch({ host }),
        teardown: () => this.dispose(),
        timing: (...args) => this.timing.observe(...args),
        draft: (update) => this.draftFollower.apply(update),
        revision: (value) => this.revisions.report(value),
      });

      if (this.isDisposed()) return;

      this.stopVisibility = this.environment.onVisibilityChange?.(() =>
        this.revisions.resume(),
      );

      this.patch({ connected: true, loginRequired: false });
      const savedDialog = this.dialogs.latest();

      if (!this.state.dialog && savedDialog?.kind === "settings") {
        this.dialogLoader.openSettings();
      } else if (!this.state.dialog && savedDialog?.kind === "delegate") {
        this.dialogLoader.openDelegate(
          savedDialog.preferredWorker,
          savedDialog.repository,
          savedDialog.revision,
        );
      }

      await this.refresh();
      if (this.isDisposed()) return;
      this.transport.watch();
      this.followUpdates();
      this.schedule();
    } catch (error) {
      if (!this.state.connected) {
        this.patch({ connection: CONNECTION.failed, ...READS_STOPPED });
      } else {
        // Keep following changes when the first host read fails transiently.
        this.followUpdates();
        this.schedule();
      }

      this.report(error);
    }
  }

  /** Waits for service changes where the transport doesn't stream them. */
  private followUpdates() {
    if (!this.transport.streamsChanges) this.updates.follow(this.viewRevision);
  }

  /**
   * Refreshes after a quiet spell, for writes the service doesn't announce,
   * such as the projects CLI's. Each completed refresh restarts the wait.
   * Without streamed changes, each update wait that runs out returns a view
   * instead.
   */
  private schedule() {
    clearTimeout(this.timer);
    if (this.disposed || !this.transport.streamsChanges) return;

    this.timer = setTimeout(
      () => this.run(() => this.fallbackRefresh()),
      FALLBACK_REFRESH_MS,
    );
  }

  private async fallbackRefresh() {
    try {
      if (!this.environment.hidden() && !this.state.busy) {
        await this.refresh();
      }
    } finally {
      if (!this.disposed) this.schedule();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.timer);
    this.revisions.dispose();
    this.stopVisibility?.();
    this.timing.dispose();
    this.transport.dispose();
    this.listeners.clear();
  }

  // Calls rather than field reads: an await can dispose the controller or
  // replace its state, but TypeScript keeps a field's narrowing across it.
  private isDisposed() {
    return this.disposed;
  }

  /** Whether disposal or a scope change made an in-flight read obsolete. */
  private stale(version: number) {
    return this.disposed || version !== this.state.scopeVersion;
  }

  async login(token: string) {
    await this.transport.login?.(token);

    this.patch({
      loginRequired: false,
      error: "",
      taskListLoading: true,
      chatHistoryLoading: this.state.selected,
      activityHistoryLoading: this.state.selected,
    });

    await this.refresh();
    this.transport.watch();
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}) {
    if (this.disposed) throw new Error("The console has closed.");

    return this.timing.fetch(panelLoadOperation(name), () =>
      this.transport.tool<T>(name, args),
    );
  }

  /** Reads and applies the panel's view at once. */
  async refresh(): Promise<void> {
    await this.load();
  }

  /**
   * Applies a view a held update wait returned. One the panel can't apply
   * now, or a wait that returned none, leaves a refresh due instead.
   */
  private async receive({ revision, view }: UpdateRead, request?: ViewRequest) {
    if (!view || !request || this.environment.hidden() || this.state.busy) {
      this.revisions.due();
    } else {
      await this.load({ revision, view, request }).catch(this.report);
    }
  }

  /** The view arguments for the panel now, with the counters that guard them. */
  private viewRequest(): ViewRequest {
    return {
      args: viewArgs(this.state, this.restoredView?.selected),
      draftRead: this.draftFollower.reading(),
      scope: this.state.scopeVersion,
      projects: this.projectGeneration,
      selection: this.generation,
      tab: this.tabIntentRevision,
    };
  }

  /**
   * Applies `held`, or reads a view at once. Loads run one at a time, and
   * one asked for meanwhile runs after.
   */
  private async load(held?: ViewRead): Promise<void> {
    if (this.disposed || !this.state.connected) return;

    if (this.refreshing) {
      this.rerun = true;

      return;
    }

    this.refreshing = true;
    let version = this.state.scopeVersion;

    try {
      if (!held && !this.state.scopeKnown) {
        const context = await this.tool<PanelData>("get_panel_context", {
          conversation_id: null,
        });

        if (this.stale(version)) return;

        if (!this.applyScope(context, false)) {
          throw new Error("The service returned no panel scope.");
        }

        version = this.state.scopeVersion;
      }

      let read = held ?? (await this.readView());

      // Parts that no longer fit are read again at once, in the scope a
      // project change may have moved to.
      while (await this.applyView(read)) {
        version = this.state.scopeVersion;
        read = await this.readView();
      }

      if (this.stale(version)) return;

      this.patch({
        ...(this.transportStatus ? {} : { connection: CONNECTION.connected }),
        error: "",
      });
    } catch (error) {
      if (this.stale(version)) return;
      this.contextRead("error", error);

      if (!this.transportStatus) {
        this.patch({ connection: CONNECTION.reconnecting });
      }

      throw error;
    } finally {
      this.finishRefresh(version);
    }
  }

  private async readView(): Promise<ViewRead> {
    const request = this.viewRequest();

    const { revision, view } = await this.timing.fetch("view", () =>
      this.tool<UpdateRead>("app_wait_for_updates", { view: request.args }),
    );

    if (!view) throw new Error("The service returned no panel view.");

    return { revision, view, request };
  }

  /**
   * Applies each part of a view that still fits the panel. Returns true when
   * parts are still to read: the list after a project change moved the
   * scope, or the selected task's details. A list that no longer fits leaves
   * a rerun due instead.
   */
  private async applyView({ revision, view, request }: ViewRead) {
    // Panel and service share the machine's clock.
    this.timing.observe("view", "deliver", Date.now() - view.built_at);

    // A held wait and an immediate read can return out of order.
    const older = olderRevision(revision, this.viewRevision);

    if (older || this.staleListRead(request.scope, request.projects)) {
      this.staleView(!older);

      return false;
    }

    this.viewRevision = revision;
    const projectUpdate = this.reconcileProjects(view.projects);

    if (this.state.conversation && projectUpdate.removed) {
      const scope = this.state.scopeVersion;

      const context = await this.tool<PanelData>("get_panel_context", {
        conversation_id: this.state.conversation,
      });

      if (this.stale(scope)) return false;

      this.applyProjectCandidate(context.panel_project_candidate);
    }

    this.restoreProject(view.projects);
    const version = this.state.scopeVersion;
    if (this.workersStale()) this.run(() => this.refreshWorkers(version));
    if (version !== request.scope) return true;

    const lacking = lacksNewSelection(
      request.args.list,
      view.list,
      this.state.selected,
    );

    if (this.staleListRead(version, request.projects, lacking)) {
      this.staleView(true);

      return false;
    }

    const { conversation, repository } = this.state;
    const tasks = tasksInScope(view.list.tasks, { conversation, repository });

    const merged = this.timing.merge("view", view.list.tasks.length, () => {
      if (!this.acceptTaskList(tasks, view.list.read_completed, request)) {
        return "rejected";
      }

      const { pending } = request.args;

      if (pending && view.pending) {
        this.pendingUpdates.show(pending.conversation_id, view.pending.tasks);
      }

      return this.detailLoader.merge(request, view) ? "merged" : "stale";
    });

    if (merged === "rejected") return false;
    if (merged === "stale") this.staleView();

    // Share after fallback selection so the host sees the same task as the panel.
    if (this.reconcileShare) {
      await this.share();
      this.reconcileShare = false;
    }

    this.dialogs.restore(tasks, version);
    if (this.stale(version)) return false;
    if (merged === "stale") return true;
    // Prefetch the selected task's change totals for the tab count. Do not hold
    // up the task list while Git reads in the background.
    this.run(() => this.changeLoader.loadCountsIfStale());
    this.run(() => this.changeLoader.loadChangesIfStale());

    return false;
  }

  /**
   * Counts a dropped view. `reread` asks for one in its place, since the
   * update wait has moved past the change the dropped view carried.
   */
  private staleView(reread = false) {
    this.timing.observe("view", "merge", 0, { stale_count: 1 });
    if (reread) this.rerun = true;
  }

  /** Every refresh outcome restarts the fallback wait and runs coalesced requests. */
  private finishRefresh(scope: number) {
    this.refreshing = false;
    if (this.started) this.schedule();

    if (
      !this.isDisposed() &&
      (this.rerun || scope !== this.state.scopeVersion)
    ) {
      this.rerun = false;
      this.run(() => this.refresh());
    }
  }

  /** Project writes, and a newer selection a read lacks, make list reads stale. */
  private staleListRead(scope: number, generation: number, lacking = false) {
    if (this.stale(scope)) return true;
    if (generation === this.projectGeneration && !lacking) return false;
    this.rerun = true;

    return true;
  }

  /** Reconciles removed approvals before reading tasks in the resulting scope. */
  private reconcileProjects(projects: Project[]) {
    const removed = this.state.projects.filter(
      (old) =>
        !projects.some((project) => project.repository === old.repository),
    );

    this.patch({ projects, projectsLoaded: true });

    const reset = projectRemovalReset(
      this.state,
      projects,
      removed,
      this.dialogs.draft("delegate")?.repository,
    );

    if (reset === "repository") {
      this.clearProjectScope();
    } else if (reset === "scope") {
      this.invalidateScope({});
      this.reconcileShare = true;
    }

    return { removed: removed.length > 0, reset: Boolean(reset) };
  }

  /** Restores the URL's project only after confirming it is still approved. */
  private restoreProject(projects: Project[]) {
    const repository = this.restoredView?.repository;

    if (
      !repository ||
      repository === this.state.repository ||
      !projects.some((project) => project.repository === repository)
    ) {
      return false;
    }

    this.invalidateScope({ repository, revision: "HEAD" });

    return true;
  }

  /**
   * Reads workers apart from the task list, which model discovery can hold
   * up for as long as Claude Code waits on a hung org policy fetch.
   */
  private async refreshWorkers(version: number) {
    const workers = await this.readWorkers();
    if (this.stale(version)) return;
    this.workersReadAt = Date.now();
    this.patch({ workers, workersLoaded: true });
  }

  /**
   * Retries workers that are unready or missing models each refresh, and
   * checks the rest once an hour.
   */
  private workersStale() {
    return (
      !this.state.workers.length ||
      this.state.workers.some(
        (worker) =>
          worker.readiness?.ready === false || worker.model_discovery_error,
      ) ||
      Date.now() - this.workersReadAt >= WORKERS_FRESH_MS
    );
  }

  /** Publishes a task list with the user's selection intent and restored view. */
  private acceptTaskList(
    tasks: Task[],
    readCompleted: TaskList["read_completed"],
    intent: Pick<ViewRequest, "tab" | "selection" | "draftRead">,
  ) {
    const taskDialog = this.state.dialog;

    // A busy dialog survives invalidation; only invalidate its original scope.
    if (
      taskDialog &&
      taskDialog.scope === this.state.scopeVersion &&
      "task" in taskDialog &&
      !tasks.some((task) => task.id === taskDialog.task.id)
    ) {
      this.invalidateScope({});
      this.reconcileShare = true;

      return false;
    }

    const taskArrival = this.arrivals.update(tasks, this.state, {
      browsing: this.browsing || Boolean(this.restoredView),
      changedSelection: intent.selection !== this.generation,
    });

    const previousSelected = this.state.selected;

    const { selected, tab, filter, search } = this.reconcileSelection(
      tasks,
      intent.tab,
    );

    // Don't persist defaults until the restored project and task resolve.
    const composing = this.restoredView?.composing;
    this.restoredView = undefined;
    this.viewStateReady = Boolean(this.viewState);

    this.patch({
      taskArrival: taskArrival?.id === selected ? undefined : taskArrival,
      tasks: this.taskActions.unread.settle(tasks),
      readCompleted: unloadedCounts(readCompleted),
      draft: this.draftFollower.retainListed(
        tasks.find((task) => task.id === selected),
        intent.draftRead,
      ),
      taskListLoading: false,
      selected,
      // Keep each first history read pending across polls until it succeeds.
      chatHistoryLoading:
        selected === previousSelected
          ? this.state.chatHistoryLoading
          : selected,
      activityHistoryLoading:
        selected === previousSelected
          ? this.state.activityHistoryLoading
          : selected,
      filter,
      search,
      tab,
    });

    this.newTasks.restore(composing);
    // The default filter can turn out to be Done or All.
    this.loadReadCompleted();

    return true;
  }

  /**
   * The selection, tab and list controls after a task-list read: a URL-restored
   * task or browsing state first, then the current task while the list still
   * has it, then the default task. A tab the user changed since this selection
   * or read began is kept.
   */
  private reconcileSelection(
    tasks: Task[],
    tabIntentRevisionAtReadStart: number,
  ) {
    let selected = this.state.selected;

    const preserveCurrentTab =
      this.tabIntentRevision !== this.tabIntentRevisionAtSelection ||
      this.tabIntentRevision !== tabIntentRevisionAtReadStart;

    if (selected && !tasks.some((task) => task.id === selected)) {
      selected = undefined;
      this.reconcileShare = true;
      this.explicitSelection = false;
      this.generation++;

      this.patch({
        events: [],
        activityFocus: undefined,
        chat: undefined,
        draft: undefined,
      });
    }

    let tab = this.state.tab;
    const restored = this.restoredView;
    const search = restored?.search ?? this.state.search;

    const filter = restored
      ? availableFilter(
          { ...this.state, tasks, search },
          restored.filter ?? this.state.filter,
        )
      : this.state.filter;

    const restoredTask = restored?.selected
      ? tasks.find((task) => task.id === restored.selected)
      : undefined;

    if (restoredTask) {
      selected = restoredTask.id;
      this.explicitSelection = true;
      this.browsing = false;

      if (!preserveCurrentTab) {
        tab = restored?.tab ?? this.tabOf(selected);
      }
    } else if (restored?.browsing) {
      selected = undefined;
      this.explicitSelection = false;
      this.browsing = true;
    }

    if (!selected) {
      selected = this.defaultSelection(tasks);

      if (selected && !preserveCurrentTab) {
        tab = this.tabOf(selected);
      }
    }

    return { selected, tab, filter, search };
  }

  async select(id: string) {
    this.choose();
    this.restoredView = undefined;
    this.patch(selectionPatch(id, this.tabOf(id)));

    await this.refresh();
    await this.share();
  }

  private tabOf = (id: string) => this.session.get("task", id).tab;

  dismissTaskArrival = () => this.patch({ taskArrival: undefined });

  async viewTaskArrival() {
    const arrival = taskArrivalTarget(this.state);
    if (arrival) await this.select(arrival.id);
  }

  back() {
    this.leaveSelection(true);
  }

  /** Clears the selection; `browsing` keeps the list from choosing one again. */
  private leaveSelection(browsing: boolean) {
    this.explicitSelection = false;
    this.browsing = browsing;
    ++this.generation;
    this.tabIntentRevision++;

    this.patch({ ...selectionPatch(undefined), newTask: undefined });
    this.run(() => this.share());
  }

  setSearch(search: string) {
    this.patch({ search });
    this.loadReadCompleted();
  }

  setFilter(filter: Filter) {
    this.patch({ filter });
    this.loadReadCompleted();
  }

  /** Reads the list again when it now shows read completed tasks it left out. */
  private loadReadCompleted() {
    if (this.state.readCompleted && showsReadCompleted(this.state)) {
      this.run(() => this.refresh());
    }
  }

  /**
   * Records a task the user or host chose, so late task-list reads keep it.
   * `newTabIntent` also starts tab tracking afresh for this selection.
   */
  private choose(newTabIntent = true) {
    ++this.generation;
    this.explicitSelection = true;
    this.browsing = false;
    this.tabIntentRevision++;

    if (newTabIntent) {
      this.tabIntentRevisionAtSelection = this.tabIntentRevision;
    }
  }

  setTab(tab: Snapshot["tab"]) {
    if (tab !== this.state.tab) this.tabIntentRevision++;
    this.patch({ tab });
    this.draftFollower.show();
    this.run(() => this.changeLoader.loadChangesIfStale());
  }

  /**
   * Opens Activity at a turn. A turn the latest activity holds scrolls into
   * view there; otherwise its own events are read and shown until
   * `showLatestActivity`.
   */
  async viewTurnActivity(turn: number) {
    await this.detailLoader.viewTurn(turn);
  }

  /** Returns Activity from a turn's own events to the latest activity. */
  showLatestActivity() {
    this.detailLoader.showLatest();
  }

  /** Reads the selected task's change totals, for its tab count and Details. */
  async loadCounts() {
    await this.changeLoader.loadCounts();
  }

  /** Reads the selected task's changes for `scope`, the current one by default. */
  async loadChanges(scope?: ChangeScope) {
    await this.changeLoader.loadChanges(scope);
  }

  /**
   * Removes a task's worktree and keeps its branch. A worktree with
   * uncommitted changes is kept; a dialog lists them and asks first.
   */
  async removeWorktree(task: Task) {
    if (this.state.busy || this.state.dialog || this.disposed) return;
    this.patch({ busy: true });
    let result: WorktreeRemoval;

    try {
      result = await this.tool<WorktreeRemoval>("app_remove_worktree", {
        task_id: task.id,
      });
    } finally {
      this.patch({ busy: false });
    }

    if (result.status === "uncommitted") {
      this.open({
        kind: "worktree",
        action: "remove",
        task,
        files: result.files,
      });
    } else {
      await this.afterWorktreeChange();
    }
  }

  /** The Changes tab and the tab count read the removed worktree or branch at once. */
  async afterWorktreeChange() {
    await this.loadChanges();
    await this.loadCounts();
    await this.refresh();
  }

  /** Shares the selected task with the host's model. */
  async share() {
    if (this.disposed || !this.state.host.canShare) return;
    const task = selectedTask(this.state);

    await this.transport.share?.({
      selected_task: this.state.selected ?? null,
      selected_item: null,
      conversation_id: this.state.conversation ?? null,
      repository: task?.repository ?? this.state.repository ?? null,
      revision: task?.revision ?? this.state.revision,
    });
  }

  private invalidateScope(patch: Partial<Snapshot>) {
    ++this.generation;
    this.explicitSelection = false;
    this.browsing = false;
    const scopeVersion = this.state.scopeVersion + 1;
    const currentDialog = this.state.dialog;

    const resolvingInitialDelegateScope =
      currentDialog?.kind === "delegate-loading" && !this.state.scopeKnown;

    const scopeSafeDialog =
      isSettingsPageDialog(currentDialog) || resolvingInitialDelegateScope
        ? { ...currentDialog, scope: scopeVersion }
        : undefined;

    if (!this.restoredView && !scopeSafeDialog) this.dialogs.clear();

    const restoredSelection = this.restoredView?.browsing
      ? undefined
      : this.restoredView?.selected;

    this.patch({
      ...patch,
      scopeVersion,
      tasks: [],
      readCompleted: undefined,
      taskListLoading: true,
      newTask: rescopedNewTask(this.state, patch, scopeVersion),
      ...selectionPatch(restoredSelection),
      ...(this.state.busy
        ? {
            formError:
              "The project or conversation changed while a request is in progress. Inspect its original outcome before retrying.",
          }
        : { dialog: scopeSafeDialog, formError: "" }),
    });
  }

  /** Forgets a removed project in the current and reload-restored view. */
  private clearProjectScope() {
    this.restoredView = undefined;
    this.invalidateScope({ repository: undefined, revision: "HEAD" });
    this.reconcileShare = true;
  }

  /** Applies host or service scope data; returns false when it carries no valid scope. */
  applyScope(data?: PanelData, refresh = true) {
    if (!data) return false;
    const scope = parsePanelScope(data.panel_scope);
    if (!scope) return false;

    const { conversation, repository, revision } = scope;

    if (
      !this.state.scopeKnown ||
      conversation !== this.state.conversation ||
      repository !== this.state.repository ||
      revision !== this.state.revision
    ) {
      this.invalidateScope({
        conversation,
        ...(conversation && PAGES[this.state.page].globalOnly
          ? { page: DEFAULT_PAGE }
          : {}),
        repository,
        revision,
        scopeKnown: true,
      });
    }

    this.applyProjectCandidate(data.panel_project_candidate);
    this.applyOpeningTasks(data, scope);

    this.contextRead("ready");
    if (refresh) this.run(() => this.refresh());

    return true;
  }

  private applyProjectCandidate(
    candidate: PanelData["panel_project_candidate"],
  ) {
    this.patch({
      projectCandidate:
        typeof candidate?.repository === "string"
          ? candidate.repository
          : undefined,
      projectCandidateAuto: candidate?.auto_register === true,
      projectCandidateGit: candidate?.git,
    });
  }

  /** Opening data can show tasks before refresh while respecting a restored view. */
  private applyOpeningTasks(
    data: PanelData,
    scope: Pick<Snapshot, "conversation" | "repository">,
  ) {
    const restoredTaskView =
      this.restoredView?.selected || this.restoredView?.browsing;

    const hostTaskId =
      typeof data.panel_selection?.task_id === "string" && !restoredTaskView
        ? data.panel_selection.task_id
        : undefined;

    if (Array.isArray(data.tasks)) {
      const tasks = tasksInScope(data.tasks, scope);

      // Opening data carries the full list, so select now as the refresh would
      // rather than showing the empty inspector until that read returns.
      this.patch({
        tasks: this.taskActions.unread.settle(tasks),
        readCompleted: unloadedCounts(data.read_completed),
        taskListLoading: false,
        ...(hostTaskId ? {} : this.fallbackSelection(tasks)),
      });
    }

    if (hostTaskId) {
      this.selectFromHost(hostTaskId, data.panel_selection?.tab);
    }
  }

  /** Host links respect a tab the user chose after selecting this task. */
  private selectFromHost(taskId: string, requestedTab?: string) {
    const preserveCurrentTab =
      taskId === this.state.selected &&
      this.tabIntentRevision !== this.tabIntentRevisionAtSelection;

    let tab: Tab;

    if (preserveCurrentTab) {
      tab = this.state.tab;
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

    this.patch({
      ...selectionPatch(taskId),
      tab,
      filter: this.restoredView?.filter ?? null,
      search: this.restoredView?.search ?? "",
    });
  }

  /** Records the panel context read for the forms waiting on it. */
  private contextRead(status: "ready" | "error", error?: unknown) {
    this.dialogLoader.contextRead(status, error);
    this.newTasks.contextRead(status, error);
  }

  async changeProject(repository?: string) {
    if (this.state.busy) return;
    this.invalidateScope({ repository, revision: "HEAD" });
    await this.refresh();
    await this.share();
  }

  async allChats() {
    if (this.state.busy || !this.state.conversation) return;

    this.invalidateScope({
      conversation: undefined,
      projectCandidate: undefined,
      projectCandidateAuto: false,
      filter: null,
      search: "",
    });

    await this.refresh();
    await this.share();
  }

  /**
   * Opened from the new-task composer, the added project becomes the
   * composer's choice and the task list keeps its scope.
   */
  addProject(forNewTask = false) {
    if (this.state.dialog || this.state.busy || !this.state.connected) return;

    this.patch({
      dialog: {
        kind: "project",
        repository: this.state.projectCandidate,
        forNewTask,
        scope: this.state.scopeVersion,
      },
      formError: "",
    });
  }

  navigate(page: PageId) {
    if (!canNavigate(this.state, page)) return;

    if (this.state.page === "settings" && page !== "settings") {
      if (this.dismissGuard?.() === false) return;

      if (isSettingsPageDialog(this.state.dialog)) this.closeDialog();
    }

    this.patch({ page, formError: "", taskArrival: undefined });
  }

  manageProjects() {
    this.navigate("projects");
  }

  backToTasks() {
    this.navigate(DEFAULT_PAGE);
  }

  removeProject(project: Project) {
    if (
      this.state.page !== "projects" ||
      this.state.conversation ||
      this.state.busy ||
      this.state.dialog ||
      !this.state.connected
    ) {
      return;
    }

    this.patch({
      dialog: {
        kind: "remove-project",
        project,
        scope: this.state.scopeVersion,
      },
      formError: "",
    });
  }

  clearProjectError() {
    if (this.state.page === "projects" && !this.state.busy) {
      this.patch({ formError: "" });
    }
  }

  /** Project writes are available globally, including their own removal dialog. */
  private canManageProject(repository: string, name?: string) {
    const { dialog, scopeVersion } = this.state;

    const removalDialog =
      dialog?.kind === "remove-project" &&
      name === undefined &&
      dialog.project.repository === repository &&
      dialog.scope === scopeVersion;

    return (
      this.state.page === "projects" &&
      (!dialog || removalDialog) &&
      !this.state.conversation &&
      !this.state.busy &&
      !this.disposed
    );
  }

  async manageProject(
    repository: string,
    name?: string,
    removal: ProjectRemoval = { deleteTasks: false },
  ): Promise<boolean> {
    const { scopeVersion: scope, dialog } = this.state;

    if (!this.canManageProject(repository, name)) return false;

    const active = () =>
      !this.disposed &&
      this.state.page === "projects" &&
      scope === this.state.scopeVersion &&
      this.state.dialog === dialog;

    ++this.projectGeneration;
    this.patch({ busy: true, formError: "" });
    let succeeded = false;
    const before = this.state.projects.find((p) => p.repository === repository);

    try {
      const result = await mutateProject(this, repository, name, removal);

      if (!active()) return false;

      this.patch({
        projects:
          name === undefined
            ? withoutProject(this.state.projects, repository)
            : renamedProject(
                this.state.projects,
                repository,
                result.name ?? name.trim(),
              ),
      });

      succeeded = true;
      if (dialog) this.closeDialog();
      const change = this.projectUndo.change(before, name, removal.deleteTasks);
      if (change) this.undo.record(change);

      if (name === undefined) {
        this.reconcileProjectRemoval(repository, removal.deleteTasks);
      }
    } catch (error) {
      if (active()) {
        this.patch({ formError: errorMessage(error) });
      }
    } finally {
      ++this.projectGeneration;

      if (!this.isDisposed()) {
        this.patch({ busy: false });

        if (scope !== this.state.scopeVersion) {
          if (dialog && this.state.dialog === dialog) this.closeDialog();
          this.run(() => this.refresh());
        }
      }
    }

    // Never retry a mutation. Other panels refresh on the change a successful write makes.
    // Cleanup can fail after deleting some tasks; always reconcile that outcome too.
    await this.refresh().catch(this.report);

    return succeeded;
  }

  /** A removed approval or its deleted selected task returns to the global list. */
  private reconcileProjectRemoval(repository: string, deleteTasks: boolean) {
    if (
      this.state.repository === repository ||
      (deleteTasks && selectedTask(this.state)?.repository === repository)
    ) {
      this.patch({ busy: false });
      this.clearProjectScope();
    }
  }

  async browseProject() {
    return this.tool<{ repository: string | null }>("app_browse_project");
  }

  async browseTaskProject(): Promise<string | undefined> {
    const dialog = this.state.dialog;

    if (
      !dialog ||
      dialog.kind !== "delegate" ||
      this.state.busy ||
      this.disposed ||
      dialog.scope !== this.state.scopeVersion
    ) {
      return;
    }

    const active = () =>
      !this.disposed &&
      this.state.dialog === dialog &&
      dialog.scope === this.state.scopeVersion;

    this.patch({ busy: true, formError: "" });

    try {
      const picked = await this.browseProject();
      // A picker can outlive its chat; only the original draft may register its selection.
      if (!picked.repository || !active()) return;

      const registered = await this.registerAndList(picked.repository);
      if (!active()) return;
      this.patch({ projects: registered.projects, projectsLoaded: true });

      return registered.repository;
    } catch (error) {
      if (active()) {
        this.patch({ formError: errorMessage(error) });
      }
    } finally {
      this.patch({ busy: false });
    }

    return undefined;
  }

  /**
   * Registers a project, then reads the list that includes it. The read is
   * new rather than shared, since a read already in flight may predate it.
   */
  private async registerAndList(repository: string) {
    const registered = await this.tool<{ repository: string }>(
      "app_register_project",
      { repository },
    );

    const projects = await this.tool<Project[]>("list_projects");

    return { repository: registered.repository, projects };
  }

  /** Add the chat project the user chose in New task before its task starts. */
  async addChatProjectForTask(repository: string) {
    const state = this.state;

    if (
      !state.projectCandidateAuto ||
      repository !== state.projectCandidate ||
      state.projects.some((project) => project.repository === repository)
    ) {
      return;
    }

    const { projects } = await this.registerAndList(repository);

    if (!this.disposed) {
      this.patch({
        projects,
        projectsLoaded: true,
        projectCandidate: undefined,
        projectCandidateAuto: false,
      });
    }
  }

  async registerProject(repository: string) {
    const { scopeVersion: scope, dialog } = this.state,
      forNewTask = dialog?.kind === "project" && dialog.forNewTask;

    let registered: string | undefined;

    await this.submit(async () => {
      const result = await this.registerAndList(repository);
      registered = result.repository;

      if (!this.disposed && scope === this.state.scopeVersion) {
        this.patch({ projects: result.projects, projectsLoaded: true });
      }

      const added = result.projects.find((p) => p.repository === registered);
      if (added) this.undo.record(this.projectUndo.addition(added));
    });

    if (
      registered &&
      !this.disposed &&
      scope === this.state.scopeVersion &&
      !this.state.dialog
    ) {
      this.patch({ projectCandidate: undefined, projectCandidateAuto: false });

      if (forNewTask && this.state.newTask) {
        this.newTasks.projectAdded(registered);
      } else if (this.state.page === "tasks") {
        await this.changeProject(registered);
      }
    }
  }

  async settings() {
    if (this.state.dialog || this.state.busy) return;

    this.navigate("settings");
    if (this.state.page !== "settings") return;
    this.dialogLoader.openSettings();
  }

  ensureSettingsLoaded() {
    if (
      this.state.page !== "settings" ||
      !this.state.connected ||
      this.state.dialog ||
      this.state.busy
    ) {
      return;
    }

    this.dialogLoader.openSettings();
  }

  backFromSettings() {
    if (this.state.busy || this.state.page !== "settings") return;
    this.navigate(DEFAULT_PAGE);
  }

  /**
   * Opens the Advanced task dialog; `draft` prefills its fields, as when the
   * new-task composer hands its message and options over.
   */
  async delegate(preferredWorker?: string, draft?: PersistedDialogDraft) {
    if (this.state.dialog || this.state.busy) return;

    this.dialogLoader.openDelegate(
      preferredWorker,
      undefined,
      undefined,
      draft,
    );
  }

  /** Lists and selects a task this panel just started. */
  private selectStarted(task: Task) {
    this.choose();
    this.restoredView = undefined;
    // Starting a task while composing, here or from Advanced, sends the draft.
    if (this.state.newTask) this.session.remove("newTask", NEW_TASK_SESSION_ID);

    this.patch({
      tasks: [task, ...this.state.tasks.filter((item) => item.id !== task.id)],
      ...selectionPatch(task.id, this.tabOf(task.id)),
      repository: task.repository,
      revision: task.revision,
    });
  }

  /** Retries the open loading dialog's failed reads. */
  retryDialogLoad() {
    this.dialogLoader.retry();
  }

  open(dialog: OpenDialogRequest) {
    if (this.state.dialog || this.state.busy) return;

    this.patch({
      dialog: { ...dialog, scope: this.state.scopeVersion },
      formError: "",
    });
  }

  /** Prepares an editable Codex message; delivery happens only when the user submits. */
  prepareHandoff(task: Task, target: HandoffTarget, contextText?: string) {
    const previous = this.state.dialog;
    if (this.disposed || this.state.busy || !this.state.conversation) return;

    if (
      previous &&
      (previous.kind !== "file" ||
        previous.task.id !== task.id ||
        previous.scope !== this.state.scopeVersion)
    ) {
      return;
    }

    if (!this.state.tasks.some((current) => current.id === task.id)) return;

    const dialog: DialogState = {
      kind: "handoff",
      task,
      target,
      scope: this.state.scopeVersion,
    };

    // Seed the form before publishing it and keep its file preview underneath.
    this.dialogs.seed(
      dialog,
      { message: handoffMessage(task, target, contextText) },
      Boolean(previous),
    );

    this.patch({ dialog, formError: "" });
  }

  /** Moves the open file preview to another of its task's changed files. */
  showChangedFile(path: string) {
    const { dialog } = this.state;
    if (dialog?.kind !== "file" || dialog.path === path) return;

    this.patch({ dialog: { ...dialog, path } });
  }

  /**
   * Lets the open form veto closing, such as to confirm discarding edits.
   * The guard returns false to stay open. Saving closes without asking it.
   */
  private dismissGuard?: () => boolean;

  guardDismiss(guard: (() => boolean) | undefined) {
    this.dismissGuard = guard;
  }

  dismiss() {
    if (
      this.state.busy ||
      !this.state.dialog ||
      this.dismissGuard?.() === false
    ) {
      return;
    }

    this.closeDialog();
  }

  /** All mutations/messages are bound to the scope visible when the dialog opened. */
  async submit(
    operation: () => Promise<Task | void>,
    selectReturned = false,
    afterSuccess?: () => void,
    closeOnSuccess = true,
  ): Promise<boolean> {
    const dialog = this.state.dialog;
    if (!dialog || this.state.busy || this.disposed) return false;

    // Loading forms may render before their dependencies, but cannot submit
    // until those reads have produced the values the request depends on.
    if (
      dialog.kind === "settings-loading" ||
      dialog.kind === "delegate-loading"
    ) {
      return false;
    }

    if (dialog.scope !== this.state.scopeVersion) {
      this.patch({
        formError:
          "The project or conversation changed. Close this form and reopen it in the current scope.",
      });

      return false;
    }

    this.patch({ busy: true, formError: "" });
    let succeeded = false;

    try {
      const task = await operation();
      if (this.isDisposed()) return false;

      if (dialog.scope !== this.state.scopeVersion) {
        throw new Error(
          "The project or conversation changed while this request was in progress. Inspect its outcome in the original scope before retrying.",
        );
      }

      if (task && selectReturned) this.selectStarted(task);

      afterSuccess?.();
      if (closeOnSuccess) this.closeDialog();
      succeeded = true;
    } catch (error) {
      this.patch({ formError: errorMessage(error) });
    } finally {
      this.patch({ busy: false });
    }

    if (succeeded) {
      await this.refresh().catch(this.report);
      if (selectReturned) await this.share().catch(this.report);
    }

    return succeeded;
  }
}
