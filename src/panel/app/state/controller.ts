import type { MessageAttachment } from "../../../shared/attachments/model.js";
import { panelLoadOperation } from "../../../shared/tasks/panel-timing";
import { ChangeLoader } from "../../features/changes/change-loader";
import {
  NewTaskLoader,
  rescopedNewTask,
} from "../../features/delegation/new-task/new-task-loader";
import { newTaskSessionId } from "../../features/delegation/new-task/new-task-values";
import { ProjectWorkerReads } from "../../features/delegation/project-worker-reads";
import { ProjectActions } from "../../features/projects/project-actions";
import { workersStale } from "../../features/providers/worker-freshness";
import { PanelSettingsSaver } from "../../features/settings/panel-settings-saver";
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
  PAGES,
  type PageId,
} from "../navigation/pages";
import { CONNECTION, type ConnectionLabel } from "./connection";
import { DialogLoader } from "./dialog-loader";
import { initialState } from "./initial-state";
import { browserEnvironment, type PanelEnvironment } from "./panel-environment";
import {
  viewArgs,
  type UpdateRead,
  type ViewRead,
  type ViewRequest,
} from "./panel-view";
import { patchState } from "./patch-state";
import {
  PersistedDialogs,
  type DialogDrafts,
} from "./persistence/persisted-dialogs";
import { persistView } from "./persistence/persisted-view";
import { RevisionTrigger } from "./revision-trigger";
import {
  parsePanelScope,
  projectRemovalReset,
  tasksInScope,
} from "./scope-reconciliation";
import { selectionPatch } from "./selection";
import { availableFilter, selectedTask, showsReadCompleted } from "./selectors";
import { SessionStateStore } from "./session/session-state";
import { TaskArrivals, taskArrivalTarget } from "./task-arrivals";
import { lacksNewSelection, unloadedCounts } from "./task-list-read";
import { TaskSelection } from "./task-selection";
import type {
  DialogState,
  Filter,
  OpenDialogRequest,
  PanelData,
  PersistedDialogDraft,
  PersistedViewState,
  Project,
  Snapshot,
  Task,
  TaskList,
  Transport,
  UiStatePersistence,
  Worker,
} from "./types";
import { UndoHistory } from "./undo-history";
import { UpdateFollower } from "./update-follower";
import {
  ViewRefresh,
  type ApplyResult,
  type RefreshOutcome,
} from "./view-refresh";

/** How long a quiet panel waits before refreshing anyway, for writes the service can't announce. */
const FALLBACK_REFRESH_MS = 30_000;

/** Ends the first-read placeholders when the panel can't read tasks. */
const READS_STOPPED = {
  taskListLoading: false,
  chatHistoryLoading: undefined,
  activityHistoryLoading: undefined,
} satisfies Partial<Snapshot>;

/** Owns async lifecycles and reviewed scope; components own presentation and drafts. */
export class Controller {
  private state: Snapshot;
  private stateContext = {
    snapshot: () => this.state,
    closed: () => this.disposed,
    patch: (patch: Partial<Snapshot>) => this.patch(patch),
    tool: <T>(...args: Parameters<Transport["tool"]>) => this.tool<T>(...args),
  };

  readonly timing: TimingReporter = new TimingReporter(this.stateContext);
  readonly panelSettings = new PanelSettingsSaver(this.stateContext);

  private draftFollower = new DraftFollower({
    ...this.stateContext,
    hidden: () => this.environment.hidden(),
    streamsDrafts: () => this.transport.streamsDrafts,
    run: (action) => this.run(action),
    refresh: () => this.refresh(),
    retarget: () => this.updates.retarget(),
  });

  readonly taskDetails = new TaskDetailLoader({
    ...this.stateContext,
    generation: () => this.selection.generation,
    setTab: (tab) => this.selection.setTab(tab),
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
  /** Which task and tab the panel shows. */
  readonly selection: TaskSelection;
  private disposed = false;
  private started = false;
  private projectGeneration = 0;
  private arrivals = new TaskArrivals();
  private restoredView?: PersistedViewState;
  private persistedDialogs: PersistedDialogs;
  /** Dialog drafts and the last settings section, for forms. */
  readonly dialogs: DialogDrafts;
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

  readonly projectWorkerReads = new ProjectWorkerReads(this.stateContext);

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

  readonly dialogLoader = new DialogLoader({
    ...this.formContext,
    seedDraft: (dialog, draft) =>
      this.persistedDialogs.seed(dialog, draft, false),
    explicitSelection: () => this.selection.explicit,
  });

  /** The new-task composer: opening, its reads and starting the task. */
  readonly newTasks = new NewTaskLoader({
    ...this.formContext,
    addChatProjectForTask: (repository) =>
      this.projects.addChatProjectForTask(repository),
    leaveSelection: () => this.selection.leave(false),
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

  readonly projects = new ProjectActions({
    ...this.stateContext,
    refresh: () => this.refresh(),
    run: (action) => this.run(action),
    report: (error) => this.report(error),
    projectWrite: () => ++this.projectGeneration,
    clearProjectScope: () => this.clearProjectScope(),
    closeDialog: () => this.closeDialog(),
    submit: (operation) => this.submit(operation),
    changeProject: (repository) => this.changeProject(repository),
    projectAdded: (repository) => this.newTasks.projectAdded(repository),
    undo: this.undo,
  });

  readonly taskActions = new TaskActions({
    timing: this.timing,
    ...this.stateContext,
    refresh: () => this.refresh(),
    report: (error) => this.report(error),
    forgetQuestion: (requestId) => this.session.remove("question", requestId),
    leaveSelection: () => this.selection.leave(true),
    select: (id) => this.selection.select(id),
    undo: this.undo,
  });

  readonly changes = new ChangeLoader({
    ...this.stateContext,
    open: (dialog) => this.open(dialog),
    refresh: () => this.refresh(),
  });

  readonly pendingUpdates = new PendingUpdateTracker(this.stateContext);

  private views = new ViewRefresh({
    timing: this.timing,
    tool: (name, args) => this.tool(name, args),
    connected: () => !this.disposed && this.state.connected,
    scope: () => this.state.scopeVersion,
    stale: (version) => this.stale(version),
    ensureScope: () => this.ensureScope(),
    request: () => this.viewRequest(),
    apply: (read) => this.applyView(read),
    settled: (outcome) => this.settled(outcome),
  });

  constructor(
    readonly transport: Transport,
    private environment: PanelEnvironment = browserEnvironment,
    private viewState?: UiStatePersistence,
  ) {
    this.session = new SessionStateStore(viewState?.composerDrafts);
    this.restoredView = viewState?.initial.view ?? {};
    const browsing = this.restoredView.browsing === true;

    this.selection = new TaskSelection(
      {
        ...this.stateContext,
        run: (action) => this.run(action),
        refresh: () => this.refresh(),
        share: () => this.share(),
        forgetRestoredView: () => (this.restoredView = undefined),
        wide: () => this.environment.wide(),
        tabShown: () => {
          this.draftFollower.show();
          this.run(() => this.changes.loadChangesIfStale());
        },
        session: this.session,
      },
      browsing,
    );

    this.dialogs = this.persistedDialogs = new PersistedDialogs(
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

    const restoredSelection = browsing ? undefined : this.restoredView.selected;

    // Seed URL-backed controls before the first render, then validate task data on load.
    this.state = {
      ...initial,
      page:
        this.persistedDialogs.latest()?.kind === "settings"
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
      this.persistedDialogs.shown(this.state.dialog, patch.dialog);
    }

    const previous = this.state;
    this.state = patchState(previous, patch);
    // Every notification reruns each subscriber's selector.
    if (this.state === previous) return;

    if (this.state.selected) {
      this.session.update("task", this.state.selected, { tab: this.state.tab });
    }

    this.listeners.forEach((listener) => listener());
    if (this.viewStateReady) this.saveViewState();
    if (previous.busy && !this.state.busy) this.revisions.resume();
  }

  private saveViewState() {
    this.viewState?.save({
      view: persistView(this.state, this.selection.browsing),
      ...this.persistedDialogs.saved(),
    });
  }

  private closeDialog() {
    this.persistedDialogs.pop();
    this.patch({ dialog: undefined, formError: "" });
    this.persistedDialogs.restore(this.state.tasks, this.state.scopeVersion);
  }

  report = (error: unknown) => {
    if (!this.disposed) this.patch({ error: errorMessage(error) });
  };

  reportActionFailure = (message: string) => {
    if (!this.disposed) this.patch({ actionFailure: message });
  };

  dismissActionFailure = () => this.patch({ actionFailure: undefined });

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

      this.stopVisibility = this.environment.onVisibilityChange?.(() => {
        // A hidden panel stops reading, and other panels may have shown the
        // tasks created meanwhile, so it announces none of them.
        if (!this.environment.hidden()) this.arrivals.reset();
        this.updates.retarget();
        this.revisions.resume();
      });

      this.patch({ connected: true, loginRequired: false });
      const savedDialog = this.persistedDialogs.latest();

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
    if (!this.transport.streamsChanges) {
      this.updates.follow(this.views.revision);
    }
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
    this.selection.invalidate();
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

  async tool<T>(
    name: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) {
    if (this.disposed) throw new Error("The console has closed.");

    return this.timing.fetch(panelLoadOperation(name), () =>
      this.transport.tool<T>(name, args, signal),
    );
  }

  /** Reads and applies the panel's view at once. */
  async refresh(): Promise<void> {
    await this.views.load();
  }

  /**
   * Applies a view a held update wait returned. One the panel can't apply
   * now, or a wait that returned none, leaves a refresh due instead.
   */
  private async receive({ revision, view }: UpdateRead, request?: ViewRequest) {
    if (!view || !request || this.environment.hidden() || this.state.busy) {
      this.revisions.due();
    } else {
      await this.views.load({ revision, view, request }).catch(this.report);
    }
  }

  /** The view arguments for the panel now, with the counters that guard them. */
  private viewRequest(): ViewRequest {
    return {
      args: viewArgs(this.state, this.restoredView?.selected),
      draftRead: this.draftFollower.reading(),
      scope: this.state.scopeVersion,
      projects: this.projectGeneration,
      selection: this.selection.generation,
      tab: this.selection.tabIntent,
    };
  }

  /** Reads the panel scope when it isn't known yet; false when the scope changed meanwhile. */
  private async ensureScope() {
    if (this.state.scopeKnown) return true;
    const version = this.state.scopeVersion;

    const context = await this.tool<PanelData>("get_panel_context", {
      conversation_id: null,
    });

    if (this.stale(version)) return false;

    if (!this.applyScope(context, false)) {
      throw new Error("The service returned no panel scope.");
    }

    return true;
  }

  /** Shows how a load ended, then restarts the fallback wait. */
  private settled(outcome: RefreshOutcome) {
    if (outcome === "applied") {
      this.patch({
        ...(this.transportStatus ? {} : { connection: CONNECTION.connected }),
        error: "",
      });
    } else if (outcome !== "stale") {
      this.contextRead("error", outcome.error);

      if (!this.transportStatus) {
        this.patch({ connection: CONNECTION.reconnecting });
      }
    }

    if (this.started) this.schedule();
  }

  /**
   * Applies each part of a view that still fits the panel. Parts still to
   * read are the list after a project change moved the scope, or the
   * selected task's details. A list that no longer fits drops the view.
   */
  private async applyView({ view, request }: ViewRead): Promise<ApplyResult> {
    if (this.staleListRead(request.scope, request.projects)) return "dropped";

    const { updating = false, settings, plan_usage } = view;
    this.patch({ updating, panelSettings: settings, planUsage: plan_usage });

    const projectUpdate = this.reconcileProjects(view.projects);

    if (this.state.conversation && projectUpdate.removed) {
      const scope = this.state.scopeVersion;

      const context = await this.tool<PanelData>("get_panel_context", {
        conversation_id: this.state.conversation,
      });

      if (this.stale(scope)) return "done";

      this.applyProjectCandidate(context.panel_project_candidate);
    }

    this.restoreProject(view.projects);
    const version = this.state.scopeVersion;
    const stale = workersStale(this.state.workers, this.workersReadAt);
    if (stale) this.run(() => this.refreshWorkers(version));
    if (version !== request.scope) return "again";

    const lacking = lacksNewSelection(
      request.args.list,
      view.list,
      this.state.selected,
    );

    if (this.staleListRead(version, request.projects, lacking)) {
      return "dropped";
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

      return this.taskDetails.merge(request, view) ? "merged" : "stale";
    });

    if (merged === "rejected") return "done";

    await this.selection.shareIfDue();

    this.persistedDialogs.restore(tasks, version);
    if (merged === "stale") return this.stale(version) ? "dropped" : "partial";
    if (this.stale(version)) return "done";
    // Prefetch the selected task's change totals for the tab count. Do not hold
    // up the task list while Git reads in the background.
    this.run(() => this.changes.loadCountsIfStale());
    this.run(() => this.changes.loadChangesIfStale());

    return "done";
  }

  /** Project writes, and a newer selection a read lacks, make list reads stale. */
  private staleListRead(scope: number, generation: number, lacking = false) {
    return (
      this.stale(scope) || generation !== this.projectGeneration || lacking
    );
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
      this.persistedDialogs.draft("delegate")?.repository,
    );

    if (reset === "repository") {
      this.clearProjectScope();
    } else if (reset === "scope") {
      this.invalidateScope({}, true);
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
      this.invalidateScope({}, true);

      return false;
    }

    const taskArrival = this.arrivals.update(tasks, this.state, {
      browsing: this.selection.browsing || Boolean(this.restoredView),
      changedSelection: intent.selection !== this.selection.generation,
    });

    const previousSelected = this.state.selected;

    const restored = this.restoredView;

    const { selected, tab } = this.selection.reconcile(
      tasks,
      intent.tab,
      restored,
    );

    // The list controls come from the restored view while it resolves.
    const search = restored?.search ?? this.state.search;

    const filter = restored
      ? availableFilter(
          { ...this.state, tasks, search },
          restored.filter ?? this.state.filter,
        )
      : this.state.filter;

    // Don't persist defaults until the restored project and task resolve.
    const composing = restored?.composing;
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

  dismissTaskArrival = () => this.patch({ taskArrival: undefined });

  async viewTaskArrival() {
    const arrival = taskArrivalTarget(this.state);
    if (arrival) await this.selection.select(arrival.id);
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

  /**
   * Moves to a new scope and clears its tasks. `share` shares the selection
   * once the new scope's list settles it.
   */
  private invalidateScope(patch: Partial<Snapshot>, share = false) {
    this.selection.reset(share);
    const scopeVersion = this.state.scopeVersion + 1;
    const currentDialog = this.state.dialog;

    const resolvingInitialDelegateScope =
      currentDialog?.kind === "delegate-loading" && !this.state.scopeKnown;

    const scopeSafeDialog =
      isSettingsPageDialog(currentDialog) || resolvingInitialDelegateScope
        ? { ...currentDialog, scope: scopeVersion }
        : undefined;

    if (!this.restoredView && !scopeSafeDialog) this.persistedDialogs.clear();

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
    this.invalidateScope({ repository: undefined, revision: "HEAD" }, true);
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

  /** Opening data can show tasks before refresh while respecting a restored view. */
  private applyOpeningTasks(
    data: PanelData,
    scope: Pick<Snapshot, "conversation" | "repository">,
  ) {
    const restored = this.restoredView;
    const restoredTaskView = restored?.selected || restored?.browsing;

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
        ...(hostTaskId ? {} : this.selection.fallback(tasks)),
      });
    }

    if (hostTaskId) {
      // A host link shows its task under the restored view's list controls.
      this.patch({
        ...this.selection.chooseFromHost(hostTaskId, data.panel_selection?.tab),
        filter: restored?.filter ?? null,
        search: restored?.search ?? "",
      });
    }
  }

  /** Lists and selects a task this panel just started. */
  private selectStarted(task: Task) {
    // Starting a task while composing, here or from Advanced, sends the draft.
    if (this.state.newTask) {
      this.session.remove("newTask", newTaskSessionId(this.state.conversation));
    }

    this.patch({
      tasks: [task, ...this.state.tasks.filter((item) => item.id !== task.id)],
      ...this.selection.chooseTask(task.id),
      repository: task.repository,
      revision: task.revision,
    });
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
    this.persistedDialogs.seed(
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

  /** Moves the open attachment preview to another of its message's attachments. */
  showAttachment(attachment: MessageAttachment) {
    const { dialog } = this.state;

    if (
      dialog?.kind !== "attachment" ||
      dialog.attachment.position === attachment.position
    ) {
      return;
    }

    this.patch({ dialog: { ...dialog, attachment } });
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
