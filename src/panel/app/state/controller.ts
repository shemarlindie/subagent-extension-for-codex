import type {
  ActivityPage,
  TurnActivityPage,
} from "../../../shared/tasks/activity/activity-tail";
import { ChangeLoader } from "../../features/changes/change-loader";
import type {
  ChangeScope,
  WorktreeRemoval,
} from "../../features/changes/types";
import {
  renamedProject,
  withoutProject,
} from "../../features/projects/project-list";
import {
  activityCursor,
  mergeActivity,
  turnStart,
} from "../../features/tasks/activity/event-history";
import { type ChatRead, mergeChat } from "../../features/tasks/chat/chat-state";
import { DraftFollower } from "../../features/tasks/chat/drafts/draft-follower";
import {
  handoffMessage,
  type HandoffTarget,
} from "../../features/tasks/controls/handoff-message";
import { ParentMessageRelay } from "../../features/tasks/controls/parent-message-relay";
import { TaskActions } from "../../features/tasks/controls/task-actions";
import { errorMessage } from "../../shared/utils/error-message";
import {
  canNavigate,
  DEFAULT_PAGE,
  type PageId,
  PAGES,
} from "../navigation/pages";
import { DialogLoader } from "./dialog-loader";
import { initialState } from "./initial-state";
import { browserEnvironment, type PanelEnvironment } from "./panel-environment";
import { PersistedDialogs } from "./persistence/persisted-dialogs";
import { RevisionTrigger } from "./revision-trigger";
import { projectRemovalReset } from "./scope-reconciliation";
import { defaultTask, selectionPatch } from "./selection";
import { filterCounts, selectedTask } from "./selectors";
import { SessionStateStore } from "./session/session-state";
import type {
  DialogState,
  Filter,
  PanelData,
  PersistedDialog,
  PersistedDialogDraft,
  PersistedViewState,
  Project,
  Snapshot,
  Tab,
  Task,
  Transport,
  UiStatePersistence,
  Worker,
} from "./types";

const POLL_INTERVAL_MS = 5000;

function availableFilter(state: Snapshot, filter: Filter | null) {
  if (!filter || filter === "all") return filter;

  // Search may have no matches while its chosen status remains valid in scope.
  return filterCounts({ ...state, search: "" })[filter] > 0 ? filter : null;
}

/** How long a ready worker list is reused before it is read again. */
const WORKERS_FRESH_MS = 60 * 60_000;

/** Owns async lifecycles and reviewed scope; components own presentation and drafts. */
export class Controller {
  private state: Snapshot;
  private draftFollower = new DraftFollower({
    snapshot: () => this.state,
    closed: () => this.disposed,
    hidden: () => this.environment.hidden(),
    streamsDrafts: () => this.transport.streamsDrafts,
    patch: (patch) => this.patch(patch),
    tool: (name, args) => this.tool(name, args),
    run: (action) => this.run(action),
    refresh: () => this.refresh(),
  });

  private parentRelay: ParentMessageRelay;

  private revisions = new RevisionTrigger({
    closed: () => this.disposed,
    hidden: () => this.environment.hidden(),
    busy: () => this.state.busy,
    refresh: () => this.run(() => this.refresh()),
    forwardParentMessage: () => this.forwardParentMessage(),
  });

  private stopVisibility?: () => void;

  private listeners = new Set<() => void>();
  readonly session = new SessionStateStore();
  private disposed = false;
  private started = false;
  private refreshing = false;
  private rerun = false;
  private generation = 0;
  private projectGeneration = 0;
  /** Protects user task and tab choices from late task-list results. */
  private tabIntentRevision = 0;
  private tabIntentRevisionAtSelection = 0;
  private reconcileShare = false;
  private browsing = false;
  private explicitSelection = false;
  private restoredView?: PersistedViewState;
  private dialogs: PersistedDialogs;
  private viewStateReady = false;
  private timer?: ReturnType<typeof setTimeout>;
  /** When workers were last read, so a CLI that breaks mid-session still shows. */
  private workersReadAt = 0;
  private projectsRead?: Promise<Project[]>;
  private workersRead?: Promise<Worker[]>;

  private dialogLoader = new DialogLoader({
    snapshot: () => this.state,
    closed: () => this.disposed,
    patch: (patch) => this.patch(patch),
    tool: (name) => this.tool(name),
    readProjects: () => this.readProjects(),
    readWorkers: async () => {
      const workers = await this.readWorkers();
      this.workersReadAt = Date.now();

      return workers;
    },
    explicitSelection: () => this.explicitSelection,
    refresh: () => this.run(() => this.refresh()),
  });

  readonly taskActions = new TaskActions({
    snapshot: () => this.state,
    closed: () => this.disposed,
    patch: (patch) => this.patch(patch),
    tool: (name, args) => this.tool(name, args),
    refresh: () => this.refresh(),
    report: (error) => this.report(error),
    forgetQuestion: (requestId) => this.session.remove("question", requestId),
  });

  private changeLoader = new ChangeLoader({
    snapshot: () => this.state,
    closed: () => this.disposed,
    patch: (patch) => this.patch(patch),
    tool: (name, args) => this.tool(name, args),
  });

  constructor(
    readonly transport: Transport,
    private environment: PanelEnvironment = browserEnvironment,
    private viewState?: UiStatePersistence,
  ) {
    this.parentRelay = new ParentMessageRelay(transport, () =>
      this.disposed || !this.state.host.canSendParent
        ? undefined
        : this.state.conversation,
    );

    this.restoredView = viewState?.initial.view ?? {};

    this.dialogs = new PersistedDialogs(
      {
        snapshot: () => this.state,
        closed: () => this.disposed,
        changed: () => {
          if (this.viewStateReady) this.saveViewState();
        },
        save: () => this.saveViewState(),
        show: (dialog) => this.patch({ dialog, formError: "" }),
        openSettings: () => this.dialogLoader.openSettings(),
        openDelegate: (...args) => this.dialogLoader.openDelegate(...args),
        explicitSelection: () => this.explicitSelection,
        tool: (name) => this.tool(name),
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
      view: {
        ...(this.state.page !== DEFAULT_PAGE ? { page: this.state.page } : {}),
        ...(this.state.repository ? { repository: this.state.repository } : {}),
        ...(this.state.selected ? { selected: this.state.selected } : {}),
        ...(this.state.filter ? { filter: this.state.filter } : {}),
        ...(this.state.search ? { search: this.state.search } : {}),
        ...(this.state.selected ? { tab: this.state.tab } : {}),
        ...(this.browsing && !this.state.selected ? { browsing: true } : {}),
      },
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
    void this.dialogs.restore(this.state.tasks, this.state.scopeVersion);
  }

  /** The task a wide or scoped panel opens when nothing is chosen, unless the user is browsing. */
  private defaultSelection(tasks: Task[]) {
    const { conversation, repository } = this.state;

    if (
      this.browsing ||
      !(this.environment.wide() || conversation || repository)
    ) {
      return undefined;
    }

    return defaultTask(tasks)?.id;
  }

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
      ...(selected ? { tab: this.session.get("task", selected).tab } : {}),
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

  showHostRequired() {
    this.patch({
      connection: "Open through MCP",
      taskListLoading: false,
      chatHistoryLoading: undefined,
      activityHistoryLoading: undefined,
    });
  }

  async start() {
    if (this.started || this.disposed) return;
    this.started = true;

    try {
      await this.transport.connect({
        scope: (data) => this.applyScope(data),
        refresh: () => this.run(() => this.refresh()),
        status: (connection) => this.patch({ connection }),
        login: () =>
          this.patch({
            loginRequired: true,
            taskListLoading: false,
            chatHistoryLoading: undefined,
            activityHistoryLoading: undefined,
          }),
        host: (host) => this.patch({ host }),
        teardown: () => this.dispose(),
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
      this.schedule();
    } catch (error) {
      if (!this.state.connected) {
        this.patch({
          connection: "Connection failed",
          taskListLoading: false,
          chatHistoryLoading: undefined,
          activityHistoryLoading: undefined,
        });
      } else {
        // Keep the panel polling when its first host read fails transiently.
        this.schedule();
      }

      this.report(error);
    }
  }

  // Registry changes and idle task deletions do not always produce stream events.
  private schedule() {
    clearTimeout(this.timer);
    if (this.disposed) return;

    this.timer = setTimeout(
      () => this.run(() => this.poll()),
      POLL_INTERVAL_MS,
    );
  }

  private async poll() {
    try {
      // Parent reports should still attempt delivery while UI reads are paused.
      this.forwardParentMessage();

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
    this.transport.dispose();
    this.listeners.clear();
  }

  // Calls rather than field reads: an await can dispose the controller or
  // replace its state, but TypeScript keeps a field's narrowing across it.
  private isDisposed() {
    return this.disposed;
  }

  private hasDialog() {
    return this.state.dialog !== undefined;
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

  private assertOpen() {
    if (this.disposed) throw new Error("The console has closed.");
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}) {
    this.assertOpen();

    return this.transport.tool<T>(name, args);
  }

  private readProjects() {
    if (this.projectsRead) return this.projectsRead;

    const request = this.tool<Project[]>("list_agent_projects");
    this.projectsRead = request;

    void request.then(
      () => {
        if (this.projectsRead === request) this.projectsRead = undefined;
      },
      () => {
        if (this.projectsRead === request) this.projectsRead = undefined;
      },
    );

    return request;
  }

  private readWorkers() {
    if (this.workersRead) return this.workersRead;

    const request = this.tool<Worker[]>("list_available_workers");
    this.workersRead = request;

    void request.then(
      () => {
        if (this.workersRead === request) this.workersRead = undefined;
      },
      () => {
        if (this.workersRead === request) this.workersRead = undefined;
      },
    );

    return request;
  }

  private forwardParentMessage() {
    if (
      !this.disposed &&
      this.state.connected &&
      this.transport.embedded &&
      this.state.scopeKnown &&
      this.state.host.canSendParent &&
      this.state.conversation
    ) {
      this.run(() => this.parentRelay.forward(this.state.conversation!));
    }
  }

  async refresh(): Promise<void> {
    if (this.disposed || !this.state.connected) return;

    if (this.refreshing) {
      this.rerun = true;

      return;
    }

    this.forwardParentMessage();

    this.refreshing = true;
    const tabIntentRevisionAtReadStart = this.tabIntentRevision;
    let version = this.state.scopeVersion;

    try {
      if (!this.state.scopeKnown) {
        const context = await this.tool<PanelData>("get_agent_panel_context", {
          conversation_id: null,
        });

        if (this.stale(version)) return;

        if (!this.applyScope(context, false)) {
          throw new Error("The service returned no panel scope.");
        }

        version = this.state.scopeVersion;
      }

      const projectGeneration = this.projectGeneration;
      const projects = await this.readProjects();
      if (this.stale(version)) return;

      if (projectGeneration !== this.projectGeneration) {
        this.rerun = true;

        return;
      }

      const removedProjects = this.state.projects.filter(
        (old) =>
          !projects.some((project) => project.repository === old.repository),
      );

      this.patch({ projects, projectsLoaded: true });

      const reset = projectRemovalReset(
        this.state,
        projects,
        removedProjects,
        this.dialogs.draft("delegate")?.repository,
      );

      if (reset) {
        if (reset === "repository") this.restoredView = undefined;

        this.invalidateScope(
          reset === "repository"
            ? { repository: undefined, revision: "HEAD" }
            : {},
        );

        version = this.state.scopeVersion;
        this.reconcileShare = true;
      }

      if (this.state.conversation && removedProjects.length) {
        const context = await this.tool<PanelData>("get_agent_panel_context", {
          conversation_id: this.state.conversation,
        });

        if (this.stale(version)) return;

        this.patch({
          projectCandidate: context.panel_project_candidate?.repository,
          projectCandidateAuto:
            context.panel_project_candidate?.auto_register === true,
        });
      }

      const preferredRepository = this.restoredView?.repository;

      if (
        preferredRepository &&
        preferredRepository !== this.state.repository &&
        projects.some((project) => project.repository === preferredRepository)
      ) {
        this.invalidateScope({
          repository: preferredRepository,
          revision: "HEAD",
        });

        version = this.state.scopeVersion;
      }

      // Workers are read again on every refresh while one can't start tasks,
      // so its notice clears once fixed, and otherwise once an hour, so a
      // runtime that breaks mid-session shows.
      if (
        !this.state.workers.length ||
        this.state.workers.some(
          (worker) => worker.readiness?.ready === false,
        ) ||
        Date.now() - this.workersReadAt >= WORKERS_FRESH_MS
      ) {
        const workers = await this.readWorkers();
        if (this.stale(version)) return;
        this.workersReadAt = Date.now();
        this.patch({ workers, workersLoaded: true });
      }

      const { conversation, repository } = this.state;

      const next = await this.tool<Task[]>("list_agent_tasks", {
        conversation_id: conversation ?? null,
        ...(repository ? { repository } : {}),
      });

      if (this.stale(version)) return;

      if (projectGeneration !== this.projectGeneration) {
        this.rerun = true;

        return;
      }

      const tasks = next.filter(
        (task) =>
          (!conversation || task.conversation_id === conversation) &&
          (!repository || task.repository === repository),
      );

      const taskDialog = this.state.dialog;

      // A busy dialog survives invalidation; only invalidate its original scope.
      if (
        taskDialog &&
        taskDialog.scope === version &&
        "task" in taskDialog &&
        !tasks.some((task) => task.id === taskDialog.task.id)
      ) {
        this.invalidateScope({});
        this.reconcileShare = true;

        return;
      }

      const previousSelected = this.state.selected;

      const { selected, tab, filter, search } = this.reconcileSelection(
        tasks,
        tabIntentRevisionAtReadStart,
      );

      // Don't replace URL choices with defaults until their project and task resolve.
      this.restoredView = undefined;
      this.viewStateReady = Boolean(this.viewState);

      this.patch({
        tasks,
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

      // Share after fallback selection so the host sees the same task as the panel.
      if (this.reconcileShare) {
        await this.share();
        this.reconcileShare = false;
      }

      await this.dialogs.restore(tasks, version);
      if (this.stale(version)) return;

      await this.loadDetail();
      if (this.stale(version)) return;
      // Prefetch the selected task's change totals for the tab count. Do not hold
      // up the task list while Git reads in the background.
      this.run(() => this.loadCountsIfStale());
      this.run(() => this.loadChangesIfStale());
      if (this.stale(version)) return;

      this.patch({
        connection: `Connected · refreshes every ${POLL_INTERVAL_MS / 1000}s`,
        error: "",
      });
    } catch (error) {
      if (this.stale(version)) return;
      const dialog = this.state.dialog;

      if (
        dialog?.kind === "delegate-loading" &&
        dialog.statuses.context === "loading"
      ) {
        this.dialogLoader.updateDelegateRead(
          dialog.request,
          "context",
          "error",
          undefined,
          error,
        );
      }

      this.patch({ connection: "Reconnecting…" });
      throw error;
    } finally {
      this.refreshing = false;

      if (
        !this.isDisposed() &&
        (this.rerun || version !== this.state.scopeVersion)
      ) {
        this.rerun = false;
        this.run(() => this.refresh());
      }
    }
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
        tab = restored?.tab ?? this.session.get("task", selected).tab;
      }
    } else if (restored?.browsing) {
      selected = undefined;
      this.explicitSelection = false;
      this.browsing = true;
    }

    if (!selected) {
      selected = this.defaultSelection(tasks);

      if (selected && !preserveCurrentTab) {
        tab = this.session.get("task", selected).tab;
      }
    }

    return { selected, tab, filter, search };
  }

  async loadDetail() {
    const id = this.state.selected,
      generation = this.generation;

    if (!id || this.disposed) return;

    const previousChat = this.state.chat;

    const isCurrentRead = () =>
      !this.disposed &&
      id === this.state.selected &&
      generation === this.generation;

    const activityRead = this.tool<ActivityPage>("get_user_agent_activity", {
      task_id: id,
      after: activityCursor(this.state.events, id),
    }).then((activity) => {
      if (!isCurrentRead()) return;

      const view = mergeActivity(
        { events: this.state.events, dropped: this.state.droppedEvents },
        id,
        activity,
      );

      this.patch({
        events: view.events,
        droppedEvents: view.dropped,
        activityHistoryLoading:
          this.state.activityHistoryLoading === id
            ? undefined
            : this.state.activityHistoryLoading,
      });
    });

    const chatRead = this.tool<ChatRead>("get_user_agent_chat", {
      task_id: id,
      after: previousChat?.task === id ? previousChat.cursor : 0,
    }).then((chat) => {
      if (!isCurrentRead()) return;

      this.patch({
        chat: mergeChat(this.state.chat, id, chat),
        chatHistoryLoading:
          this.state.chatHistoryLoading === id
            ? undefined
            : this.state.chatHistoryLoading,
      });

      this.draftFollower.follow();
    });

    await Promise.all([activityRead, chatRead]);
  }

  async select(id: string) {
    this.choose();
    this.restoredView = undefined;

    this.patch({
      ...selectionPatch(id),
      tab: this.session.get("task", id).tab,
    });

    await this.loadDetail();
    this.run(() => this.loadCountsIfStale());
    this.run(() => this.loadChangesIfStale());
    await this.share();
  }

  back() {
    this.explicitSelection = false;
    this.browsing = true;
    ++this.generation;
    this.tabIntentRevision++;

    this.patch(selectionPatch(undefined));
    this.run(() => this.share());
  }

  setSearch(search: string) {
    this.patch({ search });
  }

  setFilter(filter: Filter) {
    this.patch({ filter });
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
    this.draftFollower.follow();
    this.run(() => this.loadChangesIfStale());
  }

  /**
   * Opens Activity at a turn. A turn the latest activity holds scrolls into
   * view there; otherwise its own events are read and shown until
   * `showLatestActivity`.
   */
  async viewTurnActivity(turn: number) {
    const task = this.state.selected;
    if (!task) return;

    const request = (this.state.activityFocus?.request ?? 0) + 1,
      shown =
        turnStart(
          { events: this.state.events, dropped: this.state.droppedEvents },
          turn,
        ) !== undefined;

    this.patch({
      activityFocus: {
        task,
        turn,
        request,
        ...(shown ? {} : { range: "loading" as const }),
      },
    });

    this.setTab("activity");
    if (shown) return;

    // A newer request, another task or disposal makes this read stale.
    const current = () =>
      !this.disposed &&
      this.state.selected === task &&
      this.state.activityFocus?.request === request;

    try {
      const page = await this.tool<TurnActivityPage>(
        "get_user_agent_turn_activity",
        { task_id: task, turn },
      );

      if (current()) {
        this.patch({
          activityFocus: {
            task,
            turn,
            request,
            range: { events: page.events, dropped: page.dropped },
          },
        });
      }
    } catch (error) {
      if (current()) this.patch({ activityFocus: undefined });
      throw error;
    }
  }

  /** Returns Activity from a turn's own events to the latest activity. */
  showLatestActivity() {
    this.patch({ activityFocus: undefined });
  }

  private async loadCountsIfStale() {
    await this.changeLoader.loadCountsIfStale();
  }

  private async loadChangesIfStale() {
    await this.changeLoader.loadChangesIfStale();
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
      result = await this.tool<WorktreeRemoval>("remove_user_agent_worktree", {
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
      currentDialog?.kind === "settings" ||
      currentDialog?.kind === "settings-loading" ||
      resolvingInitialDelegateScope
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
      taskListLoading: true,
      ...selectionPatch(restoredSelection),
      ...(this.state.busy
        ? {
            formError:
              "The project or conversation changed while a request is in progress. Inspect its original outcome before retrying.",
          }
        : { dialog: scopeSafeDialog, formError: "" }),
    });
  }

  /** Applies host or service scope data; returns false when it carries no valid scope. */
  applyScope(data?: PanelData, refresh = true) {
    const scope = data?.panel_scope;

    if (
      !scope ||
      !(
        typeof scope.conversation_id === "string" ||
        scope.conversation_id === null
      ) ||
      (scope.repository !== undefined && typeof scope.repository !== "string")
    ) {
      return false;
    }

    const conversation = scope.conversation_id ?? undefined,
      repository = scope.repository,
      revision = scope.revision ?? "HEAD";

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

    this.patch({
      projectCandidate:
        typeof data.panel_project_candidate?.repository === "string"
          ? data.panel_project_candidate.repository
          : undefined,
      projectCandidateAuto:
        data.panel_project_candidate?.auto_register === true,
    });

    const restoredTaskView =
      this.restoredView?.selected || this.restoredView?.browsing;

    const hostTaskId =
      typeof data.panel_selection?.task_id === "string" && !restoredTaskView
        ? data.panel_selection.task_id
        : undefined;

    if (Array.isArray(data.tasks)) {
      const tasks = data.tasks.filter(
        (task) =>
          (!conversation || task.conversation_id === conversation) &&
          (!repository || task.repository === repository),
      );

      // Opening data carries the full list, so select now as the refresh would
      // rather than showing the empty inspector until that read returns.
      this.patch({
        tasks,
        taskListLoading: false,
        ...(hostTaskId ? {} : this.fallbackSelection(tasks)),
      });
    }

    if (hostTaskId) {
      const taskId = hostTaskId,
        hostTab = data.panel_selection?.tab as Tab;

      const preserveCurrentTab =
        taskId === this.state.selected &&
        this.tabIntentRevision !== this.tabIntentRevisionAtSelection;

      let tab: Tab;

      if (preserveCurrentTab) {
        tab = this.state.tab;
      } else if (
        (["chat", "changes", "activity", "details"] as const).includes(hostTab)
      ) {
        tab = hostTab;
      } else {
        tab = this.session.get("task", taskId).tab;
      }

      this.choose(!preserveCurrentTab);

      this.patch({
        ...selectionPatch(taskId),
        tab,
        filter: this.restoredView?.filter ?? null,
        search: this.restoredView?.search ?? "",
      });
    }

    const dialog = this.state.dialog;

    if (
      dialog?.kind === "delegate-loading" &&
      dialog.statuses.context !== "ready"
    ) {
      this.dialogLoader.updateDelegateRead(dialog.request, "context", "ready");
    }

    if (refresh) this.run(() => this.refresh());

    return true;
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

  addProject() {
    if (this.state.dialog || this.state.busy || !this.state.connected) return;

    this.patch({
      dialog: {
        kind: "project",
        repository: this.state.projectCandidate,
        scope: this.state.scopeVersion,
      },
      formError: "",
    });
  }

  navigate(page: PageId) {
    if (!canNavigate(this.state, page)) return;

    if (this.state.page === "settings" && page !== "settings") {
      if (this.dismissGuard?.() === false) return;

      if (
        this.state.dialog?.kind === "settings" ||
        this.state.dialog?.kind === "settings-loading"
      ) {
        this.closeDialog();
      }
    }

    this.patch({ page, formError: "" });
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

  async manageProject(
    repository: string,
    name?: string,
    deleteTasks = false,
  ): Promise<boolean> {
    const scope = this.state.scopeVersion;
    const dialog = this.state.dialog;

    const removalDialog =
      dialog?.kind === "remove-project" &&
      name === undefined &&
      dialog.project.repository === repository &&
      dialog.scope === scope;

    if (
      this.state.page !== "projects" ||
      (dialog && !removalDialog) ||
      this.state.conversation ||
      this.state.busy ||
      this.disposed
    ) {
      return false;
    }

    const active = () =>
      !this.disposed &&
      this.state.page === "projects" &&
      scope === this.state.scopeVersion &&
      this.state.dialog === dialog;

    ++this.projectGeneration;
    this.patch({ busy: true, formError: "" });
    let succeeded = false;

    try {
      const result = await this.tool<{ name?: string }>(
        name === undefined
          ? "remove_user_agent_project"
          : "rename_user_agent_project",
        {
          repository,
          ...(name === undefined ? { delete_tasks: deleteTasks } : { name }),
        },
      );

      ++this.projectGeneration;
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
      if (removalDialog) this.closeDialog();

      if (
        name === undefined &&
        (this.state.repository === repository ||
          (deleteTasks && selectedTask(this.state)?.repository === repository))
      ) {
        this.restoredView = undefined;
        this.patch({ busy: false });
        this.invalidateScope({ repository: undefined, revision: "HEAD" });
        this.reconcileShare = true;
      }
    } catch (error) {
      if (active()) {
        this.patch({
          formError: errorMessage(error),
        });
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

    // Never retry a mutation. Polling reconciles other panels after a successful write.
    // Cleanup can fail after deleting some tasks; always reconcile that outcome too.
    await this.refresh().catch(this.report);

    return succeeded;
  }

  async browseProject() {
    return this.tool<{ repository: string | null }>(
      "browse_user_agent_project",
    );
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
        this.patch({
          formError: errorMessage(error),
        });
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
      "register_user_agent_project",
      { repository },
    );

    const projects = await this.tool<Project[]>("list_agent_projects");

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
    const scope = this.state.scopeVersion;
    let registered: string | undefined;

    await this.submit(async () => {
      const result = await this.registerAndList(repository);
      registered = result.repository;

      if (!this.disposed && scope === this.state.scopeVersion) {
        this.patch({ projects: result.projects, projectsLoaded: true });
      }
    });

    if (
      registered &&
      !this.disposed &&
      scope === this.state.scopeVersion &&
      !this.state.dialog
    ) {
      this.patch({ projectCandidate: undefined, projectCandidateAuto: false });

      if (this.state.page === "tasks") {
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

  async delegate(preferredWorker?: string) {
    if (this.state.dialog || this.state.busy) return;

    this.dialogLoader.openDelegate(preferredWorker);
  }

  /** Retries the open loading dialog's failed reads. */
  retryDialogLoad() {
    this.dialogLoader.retry();
  }

  open(
    dialog:
      | Omit<
          Extract<DialogState, { kind: "respond" | "handoff" | "delete" }>,
          "scope"
        >
      | Omit<Extract<DialogState, { kind: "file" }>, "scope">
      | Omit<Extract<DialogState, { kind: "worktree" }>, "scope">,
  ) {
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

      if (task && selectReturned) {
        this.choose();
        this.restoredView = undefined;

        this.patch({
          tasks: [
            task,
            ...this.state.tasks.filter((item) => item.id !== task.id),
          ],
          ...selectionPatch(task.id),
          tab: this.session.get("task", task.id).tab,
          repository: task.repository,
          revision: task.revision,
        });
      }

      afterSuccess?.();
      if (closeOnSuccess) this.closeDialog();
      succeeded = true;
    } catch (error) {
      this.patch({
        formError: errorMessage(error),
      });
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
