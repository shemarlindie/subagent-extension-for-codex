import type { Draft, DraftUpdate } from "../../../src/features/tasks/drafts";
import { pendingInputKind } from "../../../src/features/tasks/model";
import type { BudgetRaise, Delivery } from "../../../src/shared/contracts";
import {
  changesKey,
  changesStale,
  readChanges,
} from "../../features/changes/read-changes";
import type {
  Changes,
  ChangeScope,
  ChangesState,
  WorktreeRemoval,
} from "../../features/changes/types";
import { delegationDialog } from "../../features/delegation/delegation";
import { readEventTail } from "../../features/tasks/activity/event-history";
import { composerMode } from "../../features/tasks/chat/chat-model";
import { type ChatRead, mergeChat } from "../../features/tasks/chat/chat-state";
import { applyDraftUpdate } from "../../features/tasks/chat/draft-state";
import { persistDialog, sameDialogReference } from "./dialog-persistence";
import { initialState } from "./initial-state";
import { filterCounts, selectedTask, terminal } from "./selectors";
import { SessionStateStore } from "./session-state";
import type {
  Defaults,
  DialogState,
  Filter,
  PanelData,
  PersistedDialog,
  PersistedDialogDraft,
  PersistedViewState,
  Project,
  SettingsDocument,
  SharedItem,
  Snapshot,
  Tab,
  Task,
  Transport,
  UiStatePersistence,
  Worker,
} from "./types";

const POLL_INTERVAL_MS = 5000;
/** How long one draft read waits for the draft to change. */
const DRAFT_WAIT_MS = 20000;
/** The least time between draft reads. */
const DRAFT_READ_GAP_MS = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function availableFilter(state: Snapshot, filter: Filter | null) {
  if (!filter || filter === "all") return filter;

  // Search may have no matches while its chosen status remains valid in scope.
  return filterCounts({ ...state, search: "" })[filter] > 0 ? filter : null;
}

/** Owns async lifecycles and reviewed scope; components own presentation and drafts. */
export class Controller {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  readonly session = new SessionStateStore();
  private disposed = false;
  private started = false;
  private refreshing = false;
  private rerun = false;
  private generation = 0;
  private browsing = false;
  private explicitSelection = false;
  private restoredView?: PersistedViewState;
  private persistedDialogs: PersistedDialog[];
  private viewStateReady = false;
  private timer?: ReturnType<typeof setTimeout>;
  /**
   * Question requests the user collapsed. New requests open expanded; a collapsed
   * one stays collapsed when its task is shown again during this session.
   */
  readonly collapsedQuestions = new Set<string>();
  constructor(
    readonly transport: Transport,
    private environment = {
      hidden: () => document.hidden,
      wide: () => window.innerWidth > 640,
    },
    private viewState?: UiStatePersistence,
  ) {
    this.restoredView = viewState?.initial.view ?? {};
    this.persistedDialogs = viewState?.initial.dialogs ?? [];
    const initial = initialState();

    // Seed URL-backed controls before the first render, then validate task data on load.
    this.state = {
      ...initial,
      filter: this.restoredView.filter ?? initial.filter,
      search: this.restoredView.search ?? initial.search,
      tab: this.restoredView.tab ?? initial.tab,
    };

    this.browsing = this.restoredView.browsing === true;
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  private patch(patch: Partial<Snapshot>) {
    if (this.disposed) return;

    if ("dialog" in patch && patch.dialog !== this.state.dialog) {
      if (patch.dialog) {
        const descriptor = persistDialog(patch.dialog),
          previous = this.persistedDialogs.at(-1);

        if (sameDialogReference(previous, descriptor))
          this.persistedDialogs[this.persistedDialogs.length - 1] = {
            ...descriptor,
            ...(previous?.draft ? { draft: previous.draft } : {}),
          } as PersistedDialog;
        else this.persistedDialogs = [descriptor];
      }
    }

    this.state = { ...this.state, ...patch };
    if (this.state.selected)
      this.session.update("task", this.state.selected, { tab: this.state.tab });
    this.listeners.forEach((listener) => listener());
    if (this.viewStateReady) this.saveViewState();
  }

  private saveViewState() {
    this.viewState?.save({
      view: {
        ...(this.state.repository ? { repository: this.state.repository } : {}),
        ...(this.state.selected ? { selected: this.state.selected } : {}),
        ...(this.state.filter ? { filter: this.state.filter } : {}),
        ...(this.state.search ? { search: this.state.search } : {}),
        ...(this.state.selected ? { tab: this.state.tab } : {}),
        ...(this.browsing && !this.state.selected ? { browsing: true } : {}),
      },
      ...(this.persistedDialogs.length
        ? { dialogs: [...this.persistedDialogs] }
        : {}),
    });
  }

  getDialogDraft(kind: PersistedDialog["kind"]) {
    const dialog = this.persistedDialogs.at(-1);

    return dialog?.kind === kind ? dialog.draft : undefined;
  }

  saveDialogDraft(kind: PersistedDialog["kind"], draft: PersistedDialogDraft) {
    if (this.disposed || this.state.dialog?.kind !== kind) return;

    const descriptor =
      this.persistedDialogs.at(-1) ?? persistDialog(this.state.dialog);

    if (descriptor.kind !== kind) return;

    if (!this.persistedDialogs.length) this.persistedDialogs.push(descriptor);

    this.persistedDialogs[this.persistedDialogs.length - 1] = {
      ...descriptor,
      draft: { ...descriptor.draft, ...draft },
    } as PersistedDialog;

    if (this.viewStateReady) this.saveViewState();
  }

  saveDialogField(kind: PersistedDialog["kind"], name: string, value: unknown) {
    this.saveDialogDraft(kind, {
      ...this.getDialogDraft(kind),
      [name]: value,
    });
  }

  private async restorePersistedDialog(tasks: Task[], scope: number) {
    const saved = this.persistedDialogs.at(-1);
    if (!saved || this.state.dialog) return;

    const task =
      "taskId" in saved
        ? tasks.find((item) => item.id === saved.taskId)
        : undefined;

    if ("taskId" in saved && !task) {
      await this.discardPersistedDialog(saved, tasks, scope);

      return;
    }

    try {
      let dialog: DialogState | undefined;

      switch (saved.kind) {
        case "project":
          dialog = {
            kind: "project",
            repository: saved.repository,
            scope,
          };

          break;

        case "settings": {
          const settings =
            await this.tool<SettingsDocument>("get_agent_settings");

          if (!this.canRestoreDialog(saved, scope) || this.state.dialog) return;

          if (!Array.isArray(settings.sections)) {
            await this.discardPersistedDialog(saved, tasks, scope);

            return;
          }

          dialog = { kind: "settings", settings, scope };
          break;
        }

        case "delegate": {
          const { values: defaults } = await this.tool<{ values: Defaults }>(
            "get_agent_settings",
          );

          if (!this.canRestoreDialog(saved, scope) || this.state.dialog) return;

          const base = delegationDialog(
            { ...this.state, tasks },
            this.state.projects,
            defaults,
            this.explicitSelection,
            saved.preferredWorker,
          );

          dialog = {
            ...base,
            repository: saved.repository ?? base.repository,
            revision: saved.revision ?? base.revision,
          };

          break;
        }

        case "respond":
          if (
            !task!.pending_input ||
            pendingInputKind(task!.pending_input) === "question" ||
            (saved.requestId && task!.pending_input.id !== saved.requestId)
          ) {
            await this.discardPersistedDialog(saved, tasks, scope);

            return;
          }

          dialog = { kind: saved.kind, task: task!, scope };
          break;
        case "handoff":
        case "delete":
          dialog = { kind: saved.kind, task: task!, scope };
          break;
        case "file":
          dialog = {
            kind: saved.kind,
            task: task!,
            path: saved.path,
            scope,
          };

          break;
        case "worktree":
          dialog = {
            kind: saved.kind,
            action: saved.action,
            task: task!,
            files: saved.files,
            scope,
          };

          break;
      }

      if (dialog && this.canRestoreDialog(saved, scope) && !this.state.dialog)
        this.patch({ dialog, formError: "" });
    } catch {
      // Keep the saved descriptor so a later refresh can retry transient reads.
    }
  }

  private canRestoreDialog(saved: PersistedDialog, scope: number) {
    return (
      !this.disposed &&
      scope === this.state.scopeVersion &&
      sameDialogReference(this.persistedDialogs.at(-1), saved)
    );
  }

  private async discardPersistedDialog(
    saved: PersistedDialog,
    tasks: Task[],
    scope: number,
  ) {
    if (!this.canRestoreDialog(saved, scope)) return;
    this.persistedDialogs.pop();
    this.saveViewState();
    await this.restorePersistedDialog(tasks, scope);
  }

  private closeDialog() {
    this.persistedDialogs.pop();
    this.patch({ dialog: undefined, formError: "" });
    void this.restorePersistedDialog(this.state.tasks, this.state.scopeVersion);
  }

  report = (error: unknown) => {
    if (!this.disposed)
      this.patch({
        error: error instanceof Error ? error.message : String(error),
      });
  };

  run = (action: () => Promise<unknown>) => {
    void action().catch(this.report);
  };

  showHostRequired() {
    this.patch({ connection: "Open through MCP" });
  }

  async start() {
    if (this.started || this.disposed) return;
    this.started = true;

    try {
      await this.transport.connect({
        scope: (data) => this.applyScope(data),
        refresh: () => this.run(() => this.refresh()),
        status: (connection) => this.patch({ connection }),
        login: () => this.patch({ loginRequired: true }),
        host: (host) => this.patch({ host }),
        teardown: () => this.dispose(),
        draft: (update) => this.applyDraft(update),
      });

      if (this.disposed) return;

      this.patch({ connected: true, loginRequired: false });
      await this.refresh();
      if (this.disposed) return;
      this.transport.watch();
      if (this.transport.embedded) this.schedule();
    } catch (error) {
      if (!this.state.connected) {
        this.patch({ connection: "Connection failed" });
      } else if (this.transport.embedded) {
        // Keep the panel polling when its first host read fails transiently.
        this.schedule();
      }

      this.report(error);
    }
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.disposed) return;

    this.timer = setTimeout(async () => {
      try {
        if (!this.environment.hidden() && !this.state.busy)
          await this.refresh();
      } catch (error) {
        this.report(error);
      } finally {
        if (!this.disposed) this.schedule();
      }
    }, POLL_INTERVAL_MS);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.timer);
    this.transport.dispose();
    this.listeners.clear();
  }

  async login(token: string) {
    await this.transport.login?.(token);
    this.patch({ loginRequired: false, error: "" });
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

  async refresh(): Promise<void> {
    if (this.disposed || !this.state.connected) return;

    if (this.refreshing) {
      this.rerun = true;

      return;
    }

    this.refreshing = true;
    let version = this.state.scopeVersion;

    try {
      if (!this.state.scopeKnown) {
        const context = await this.tool<PanelData>("get_agent_panel_context", {
          conversation_id: null,
        });

        if (this.disposed || version !== this.state.scopeVersion) return;
        this.applyScope(context, false);
        if (!this.state.scopeKnown)
          throw new Error("The service returned no panel scope.");
        version = this.state.scopeVersion;
      }

      const projects = await this.tool<Project[]>("list_agent_projects");
      if (this.disposed || version !== this.state.scopeVersion) return;
      this.patch({ projects });

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

      if (!this.state.workers.length) {
        const workers = await this.tool<Worker[]>("list_available_workers");
        if (this.disposed || version !== this.state.scopeVersion) return;
        this.patch({ workers });
      }

      const { conversation, repository } = this.state;

      const next = await this.tool<Task[]>("list_agent_tasks", {
        conversation_id: conversation ?? null,
        ...(repository ? { repository } : {}),
      });

      if (this.disposed || version !== this.state.scopeVersion) return;

      const tasks = next.filter(
        (task) =>
          (!conversation || task.conversation_id === conversation) &&
          (!repository || task.repository === repository),
      );

      let selected = this.state.selected;

      if (selected && !tasks.some((task) => task.id === selected)) {
        selected = undefined;
        this.explicitSelection = false;
        this.generation++;
        this.patch({ events: [], chat: undefined, draft: undefined });
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
        tab = restored?.tab ?? this.session.get("task", selected).tab;
      } else if (restored?.browsing) {
        selected = undefined;
        this.explicitSelection = false;
        this.browsing = true;
      }

      if (
        !selected &&
        !this.browsing &&
        tasks.length &&
        (this.environment.wide() || conversation || repository)
      ) {
        selected =
          tasks.find((task) => task.pending_input)?.id ??
          tasks.find((task) => !terminal(task))?.id ??
          tasks[0].id;

        tab = this.session.get("task", selected).tab;
      }

      // Don't replace URL choices with defaults until their project and task resolve.
      this.restoredView = undefined;
      this.viewStateReady = Boolean(this.viewState);

      this.patch({
        tasks,
        selected,
        filter,
        search,
        tab,
      });

      await this.restorePersistedDialog(tasks, version);
      if (this.disposed || version !== this.state.scopeVersion) return;

      await this.loadDetail();
      if (this.disposed || version !== this.state.scopeVersion) return;
      // Changes are read live from Git, which polling would repeat for every
      // task in view, so they reload only when the task's status or turn moves.
      await this.loadChangesIfStale();
      if (this.disposed || version !== this.state.scopeVersion) return;

      this.patch({
        connection: `Connected · refreshes every ${POLL_INTERVAL_MS / 1000}s`,
        error: "",
      });
    } catch (error) {
      if (this.disposed || version !== this.state.scopeVersion) return;
      this.patch({ connection: "Reconnecting…" });
      throw error;
    } finally {
      this.refreshing = false;

      if (
        !this.disposed &&
        (this.rerun || version !== this.state.scopeVersion)
      ) {
        this.rerun = false;
        this.run(() => this.refresh());
      }
    }
  }

  async loadDetail() {
    const id = this.state.selected,
      generation = this.generation;

    if (!id || this.disposed) return;

    const previousChat = this.state.chat;

    const [{ events, dropped }, chat] = await Promise.all([
      readEventTail(
        id,
        this.state.events,
        (after) => this.tool("get_agent_events", { task_id: id, after }),
        () => !this.disposed && generation === this.generation,
        this.state.droppedEvents,
      ),
      this.tool<ChatRead>("get_user_agent_chat", {
        task_id: id,
        after: previousChat?.task === id ? previousChat.cursor : 0,
      }),
    ]);

    if (
      this.disposed ||
      id !== this.state.selected ||
      generation !== this.generation
    )
      return;

    this.patch({
      events,
      droppedEvents: dropped,
      chat: mergeChat(this.state.chat, id, chat),
    });

    this.followDraft();
  }

  async select(id: string) {
    this.explicitSelection = true;
    this.browsing = false;
    ++this.generation;

    this.patch({
      selected: id,
      events: [],
      chat: undefined,
      draft: undefined,
      tab: this.session.get("task", id).tab,
    });

    await this.loadDetail();
    await this.loadChangesIfStale();
    await this.share();
  }

  back() {
    this.explicitSelection = false;
    this.browsing = true;
    ++this.generation;

    this.patch({
      selected: undefined,
      events: [],
      chat: undefined,
      draft: undefined,
    });

    this.run(() => this.share());
  }

  setSearch(search: string) {
    this.patch({ search });
  }

  setFilter(filter: Filter) {
    this.patch({ filter });
  }

  setTab(tab: Snapshot["tab"]) {
    this.patch({ tab });
    this.followDraft();
    this.run(() => this.loadChangesIfStale());
  }

  /** Reads the selected task's changes when a tab showing them is open. */
  private async loadChangesIfStale() {
    const task = selectedTask(this.state);

    if (
      task &&
      (this.state.tab === "changes" || this.state.tab === "details") &&
      changesStale(this.state.changes, task)
    )
      await this.loadChanges();
  }

  /**
   * Reads the selected task's changes, every page, for `scope` (the current
   * one by default). The last result stays shown while a reload runs.
   */
  async loadChanges(scope?: ChangeScope) {
    const task = selectedTask(this.state);
    if (!task || this.disposed) return;

    const previous =
      this.state.changes?.task === task.id ? this.state.changes : undefined;

    const next = scope ?? previous?.scope ?? "task";

    const changes: ChangesState = {
      task: task.id,
      scope: next,
      key: changesKey(task),
      loading: true,
      data: previous?.scope === next ? previous.data : undefined,
    };

    let current = changes;
    this.patch({ changes });
    // A newer read, or another task, replaces this one.
    const live = () => !this.disposed && this.state.changes === current;

    try {
      const data = await readChanges(
        task.id,
        changes.scope,
        (args) => this.tool<Changes>("get_user_agent_changes", args),
        live,
      );

      if (data && live()) {
        current = { ...changes, loading: false, data };
        this.patch({ changes: current });
      }
    } catch (error) {
      if (!live()) return;

      current = {
        ...changes,
        loading: false,
        data: undefined,
        error: error instanceof Error ? error.message : String(error),
      };

      this.patch({ changes: current });
    }
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

    if (result.status === "uncommitted")
      this.open({
        kind: "worktree",
        action: "remove",
        task,
        files: result.files,
      });
    else await this.afterWorktreeChange();
  }

  /** The Changes tab reads the removed worktree or branch at once. */
  async afterWorktreeChange() {
    await this.loadChanges();
    await this.refresh();
  }

  /** Shares the selected task, and optionally one item in it, with the host's model. */
  async share(item?: SharedItem) {
    if (this.disposed || !this.state.host.canShare) return;
    const task = selectedTask(this.state);

    await this.transport.share?.({
      selected_task: this.state.selected ?? null,
      selected_item: item ?? null,
      conversation_id: this.state.conversation ?? null,
      repository: task?.repository ?? this.state.repository ?? null,
      revision: task?.revision ?? this.state.revision,
    });
  }

  private invalidateScope(patch: Partial<Snapshot>) {
    ++this.generation;
    this.explicitSelection = false;
    this.browsing = false;
    if (!this.restoredView) this.persistedDialogs = [];

    this.patch({
      ...patch,
      scopeVersion: this.state.scopeVersion + 1,
      tasks: [],
      selected: undefined,
      events: [],
      chat: undefined,
      draft: undefined,
      ...(this.state.busy
        ? {
            formError:
              "The project or conversation changed while a request is in progress. Inspect its original outcome before retrying.",
          }
        : { dialog: undefined, formError: "" }),
    });
  }

  applyScope(data?: PanelData, refresh = true) {
    const scope = data?.panel_scope;
    if (
      !scope ||
      !(
        typeof scope.conversation_id === "string" ||
        scope.conversation_id === null
      ) ||
      (scope.repository !== undefined && typeof scope.repository !== "string")
    )
      return;

    const conversation = scope.conversation_id ?? undefined,
      repository = scope.repository,
      revision = scope.revision ?? "HEAD";

    if (
      !this.state.scopeKnown ||
      conversation !== this.state.conversation ||
      repository !== this.state.repository ||
      revision !== this.state.revision
    )
      this.invalidateScope({
        conversation,
        repository,
        revision,
        scopeKnown: true,
      });

    this.patch({
      projectCandidate:
        typeof data?.panel_project_candidate?.repository === "string"
          ? data.panel_project_candidate.repository
          : undefined,
      projectCandidateAuto:
        data?.panel_project_candidate?.auto_register === true,
    });

    if (Array.isArray(data?.tasks)) {
      const tasks = data.tasks.filter(
        (task) =>
          (!conversation || task.conversation_id === conversation) &&
          (!repository || task.repository === repository),
      );

      this.patch({ tasks });
    }

    const restoredTaskView =
      this.restoredView?.selected || this.restoredView?.browsing;

    if (
      typeof data?.panel_selection?.task_id === "string" &&
      !restoredTaskView
    ) {
      ++this.generation;
      this.explicitSelection = true;
      this.browsing = false;

      this.patch({
        selected: data.panel_selection.task_id,
        events: [],
        chat: undefined,
        draft: undefined,
        tab: (["chat", "changes", "activity", "details"] as const).includes(
          data.panel_selection.tab as Tab,
        )
          ? (data.panel_selection.tab as Tab)
          : this.session.get("task", data.panel_selection.task_id).tab,
        filter: this.restoredView?.filter ?? null,
        search: this.restoredView?.search ?? "",
      });
    }

    if (refresh) this.run(() => this.refresh());
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

  async browseProject() {
    return this.tool<{ repository: string | null }>(
      "browse_user_agent_project",
    );
  }

  /** Pick a folder and register it without the project dialog, then scope to it. */
  async browseAndAddProject() {
    if (this.state.dialog || this.state.busy || !this.state.connected) return;
    const scope = this.state.scopeVersion;
    this.patch({ busy: true, error: "" });

    try {
      const picked = await this.browseProject();
      if (
        !picked.repository ||
        this.disposed ||
        scope !== this.state.scopeVersion
      )
        return;

      const registered = await this.tool<{ repository: string }>(
        "register_user_agent_project",
        { repository: picked.repository },
      );

      const projects = await this.tool<Project[]>("list_agent_projects");
      if (this.disposed || scope !== this.state.scopeVersion) return;

      this.patch({
        projects,
        projectCandidate: undefined,
        projectCandidateAuto: false,
        busy: false,
      });

      await this.changeProject(registered.repository);
    } finally {
      // A scope change already reset busy; clearing it again would stomp the new scope's work.
      if (!this.disposed && scope === this.state.scopeVersion)
        this.patch({ busy: false });
    }
  }

  async browseTaskProject(): Promise<string | undefined> {
    const dialog = this.state.dialog;
    if (
      !dialog ||
      dialog.kind !== "delegate" ||
      this.state.busy ||
      this.disposed ||
      dialog.scope !== this.state.scopeVersion
    )
      return;

    const active = () =>
      !this.disposed &&
      this.state.dialog === dialog &&
      dialog.scope === this.state.scopeVersion;

    this.patch({ busy: true, formError: "" });

    try {
      const picked = await this.browseProject();
      // A picker can outlive its chat; only the original draft may register its selection.
      if (!picked.repository || !active()) return;

      const registered = await this.tool<{ repository: string }>(
        "register_user_agent_project",
        { repository: picked.repository },
      );

      if (!active()) return;
      const projects = await this.tool<Project[]>("list_agent_projects");
      if (!active()) return;
      this.patch({ projects });

      return registered.repository;
    } catch (error) {
      if (active())
        this.patch({
          formError: error instanceof Error ? error.message : String(error),
        });
    } finally {
      this.patch({ busy: false });
    }
  }

  /** Add the chat project the user chose in New task before its task starts. */
  async addChatProjectForTask(repository: string) {
    const state = this.state;
    if (
      !state.projectCandidateAuto ||
      repository !== state.projectCandidate ||
      state.projects.some((project) => project.repository === repository)
    )
      return;
    await this.tool("register_user_agent_project", { repository });
    const projects = await this.tool<Project[]>("list_agent_projects");
    if (!this.disposed)
      this.patch({
        projects,
        projectCandidate: undefined,
        projectCandidateAuto: false,
      });
  }

  async registerProject(repository: string) {
    const scope = this.state.scopeVersion;
    let registered: { repository: string } | undefined;

    await this.submit(async () => {
      registered = await this.tool<{ repository: string }>(
        "register_user_agent_project",
        { repository },
      );

      const projects = await this.tool<Project[]>("list_agent_projects");
      if (!this.disposed && scope === this.state.scopeVersion)
        this.patch({ projects });
    });

    if (
      registered &&
      !this.disposed &&
      scope === this.state.scopeVersion &&
      !this.state.dialog
    ) {
      this.patch({ projectCandidate: undefined, projectCandidateAuto: false });
      await this.changeProject(registered.repository);
    }
  }

  async settings() {
    if (this.state.dialog || this.state.busy) return;
    const scope = this.state.scopeVersion;
    const settings = await this.tool<SettingsDocument>("get_agent_settings");
    if (this.disposed || scope !== this.state.scopeVersion || this.state.dialog)
      return;
    if (!Array.isArray(settings.sections))
      throw new Error(
        "Settings are unavailable in this preview or service version.",
      );

    this.patch({
      dialog: { kind: "settings", settings, scope },
      formError: "",
    });
  }

  async delegate(preferredWorker?: string) {
    if (this.state.dialog || this.state.busy) return;
    const scope = this.state.scopeVersion;

    const { values: defaults } = await this.tool<{ values: Defaults }>(
      "get_agent_settings",
    );

    if (this.disposed || scope !== this.state.scopeVersion || this.state.dialog)
      return;
    const projects = await this.tool<Project[]>("list_agent_projects");
    if (this.disposed || scope !== this.state.scopeVersion || this.state.dialog)
      return;

    this.patch({
      projects,
      dialog: delegationDialog(
        this.state,
        projects,
        defaults,
        this.explicitSelection,
        preferredWorker,
      ),
      formError: "",
    });
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
      dialog: { ...dialog, scope: this.state.scopeVersion } as DialogState,
      formError: "",
    });
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
    )
      return;
    this.closeDialog();
  }

  /**
   * Answers a worker's pending question from the task inspector, outside any dialog.
   * Resolves with the failure message, or nothing once the answer is sent.
   */
  async answer(
    task: Task,
    answers: Record<string, string>,
  ): Promise<string | undefined> {
    const request = task.pending_input;
    if (!request || this.state.busy || this.disposed) return;
    this.patch({ busy: true });

    try {
      await this.tool("submit_agent_input", {
        task_id: task.id,
        request_id: request.id,
        approved: true,
        input: { ...request.input, answers },
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      this.patch({ busy: false });
    }

    // The request is answered, so nothing about it needs remembering.
    this.session.remove("question", request.id);
    this.collapsedQuestions.delete(request.id);
    await this.refresh().catch(this.report);
  }

  /** Applies a streamed draft update for the selected task. */
  private applyDraft(update: DraftUpdate) {
    if (update.task_id !== this.state.selected) return;
    const { draft, stale } = applyDraftUpdate(this.state.draft, update);
    this.patch({ draft });
    // The whole message is stored now; read it.
    if ("cleared" in update) this.run(() => this.refresh());
    else if (stale) this.run(() => this.readDraft());
  }

  /** Reads the selected task's draft in full, after a missed update. */
  private async readDraft() {
    const id = this.state.selected;
    if (!id) return;

    const read = await this.tool<{ draft: Draft | null }>(
      "get_user_agent_draft",
      { task_id: id },
    );

    if (this.state.selected === id)
      this.patch({
        draft: read.draft ? { task: id, ...read.draft } : undefined,
      });
  }

  private followingDraft = false;

  /**
   * Follows a running task's draft while Chat shows it, where the transport
   * can't stream it: each read waits until the draft changes, then the next
   * one starts.
   */
  private followDraft() {
    if (this.transport.streamsDrafts || this.followingDraft) return;
    this.followingDraft = true;

    void (async () => {
      try {
        while (!this.disposed) {
          const task = selectedTask(this.state);

          if (
            !task ||
            composerMode(task) === "idle" ||
            this.state.tab !== "chat" ||
            this.environment.hidden()
          )
            break;

          const known =
            this.state.draft?.task === task.id ? this.state.draft : undefined;

          const started = Date.now();
          let read: { draft: Draft | null; running: boolean };

          try {
            read = await this.tool("get_user_agent_draft", {
              task_id: task.id,
              ...(known
                ? {
                    message_id: known.message_id,
                    after_length: known.text.length,
                  }
                : {}),
              wait_ms: DRAFT_WAIT_MS,
            });
          } catch {
            await sleep(2000);
            continue;
          }

          if (this.disposed || this.state.selected !== task.id) continue;

          const draft = read.draft
            ? { task: task.id, ...read.draft }
            : undefined;

          const changed =
            draft?.message_id !== known?.message_id ||
            draft?.text !== known?.text;

          this.patch({ draft });
          // The whole message, or the turn's end, is stored now; read it.
          if (known && !draft) this.run(() => this.refresh());
          if (!read.running) break;
          // A read that came back at once with nothing new waits a little,
          // and reads stay at least DRAFT_READ_GAP_MS apart, so a fast stream
          // renders at most that often.
          const elapsed = Date.now() - started;
          if (!changed && elapsed < 500) await sleep(1000);
          else if (elapsed < DRAFT_READ_GAP_MS)
            await sleep(DRAFT_READ_GAP_MS - elapsed);
        }
      } finally {
        this.followingDraft = false;
      }
    })();
  }

  /**
   * Runs a Chat action, outside any dialog. Resolves with the failure
   * message, or nothing once it's done and the task has reloaded.
   */
  private async chatAction(
    operation: () => Promise<unknown>,
  ): Promise<string | undefined> {
    if (this.state.busy || this.disposed) return "Wait for the last action.";
    this.patch({ busy: true });

    try {
      await operation();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      this.patch({ busy: false });
    }

    await this.refresh().catch(this.report);
  }

  /** Sends the user's message to a task, as steer, queue or interrupt. */
  sendMessage(
    task: Task,
    message: string,
    delivery: Delivery,
    budget?: BudgetRaise,
  ) {
    return this.chatAction(() =>
      this.tool("send_user_agent_message", {
        task_id: task.id,
        message,
        delivery,
        ...(budget ? { budget } : {}),
      }),
    );
  }

  /** Stops a task's turn; `sendPending` sends its pending steers at once. */
  interruptTask(task: Task, sendPending = false) {
    return this.chatAction(() =>
      this.tool("interrupt_agent_task", {
        task_id: task.id,
        send_pending: sendPending,
      }),
    );
  }

  editQueued(task: Task, messageId: string, message: string) {
    return this.chatAction(() =>
      this.tool("edit_user_agent_queued_message", {
        task_id: task.id,
        message_id: messageId,
        message,
      }),
    );
  }

  removeQueued(task: Task, messageId: string) {
    return this.chatAction(() =>
      this.tool("remove_user_agent_queued_message", {
        task_id: task.id,
        message_id: messageId,
      }),
    );
  }

  resumeQueue(task: Task) {
    return this.chatAction(() =>
      this.tool("resume_user_agent_queue", { task_id: task.id }),
    );
  }

  clearQueue(task: Task) {
    return this.chatAction(() =>
      this.tool("clear_user_agent_queue", { task_id: task.id }),
    );
  }

  /** All mutations/messages are bound to the scope visible when the dialog opened. */
  async submit(
    operation: () => Promise<Task | void>,
    selectReturned = false,
    afterSuccess?: () => void,
  ) {
    const dialog = this.state.dialog;
    if (!dialog || this.state.busy || this.disposed) return;

    if (dialog.scope !== this.state.scopeVersion) {
      this.patch({
        formError:
          "The project or conversation changed. Close this form and reopen it in the current scope.",
      });

      return;
    }

    this.patch({ busy: true, formError: "" });
    let succeeded = false;

    try {
      const task = await operation();
      if (this.disposed) return;
      if (dialog.scope !== this.state.scopeVersion)
        throw new Error(
          "The project or conversation changed while this request was in progress. Inspect its outcome in the original scope before retrying.",
        );

      if (task && selectReturned) {
        ++this.generation;
        this.explicitSelection = true;
        this.browsing = false;

        this.patch({
          tasks: [
            task,
            ...this.state.tasks.filter((item) => item.id !== task.id),
          ],
          selected: task.id,
          events: [],
          chat: undefined,
          draft: undefined,
          tab: this.session.get("task", task.id).tab,
          repository: task.repository,
          revision: task.revision,
        });
      }

      afterSuccess?.();
      this.closeDialog();
      succeeded = true;
    } catch (error) {
      this.patch({
        formError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.patch({ busy: false });
    }

    if (succeeded) {
      await this.refresh().catch(this.report);
      if (selectReturned) await this.share().catch(this.report);
    }
  }
}
