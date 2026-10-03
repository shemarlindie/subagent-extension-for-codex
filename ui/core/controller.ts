import type {
  Artifact,
  Defaults,
  DialogState,
  Filter,
  Mode,
  PanelData,
  Project,
  Snapshot,
  SettingsDocument,
  Task,
  Transport,
  Worker,
} from "./types";
import { selectedTask, terminal } from "./selectors";
import { initialState } from "./initial-state";
import { readEventTail } from "./event-history";
import { delegationDialog } from "./delegation";

/** Owns async lifecycles and reviewed scope; components own presentation and drafts. */
export class Controller {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  private disposed = false;
  private started = false;
  private refreshing = false;
  private rerun = false;
  private generation = 0;
  private browsing = false;
  private explicitSelection = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly transport: Transport,
    mode: Mode,
    private environment = {
      hidden: () => document.hidden,
      wide: () => window.innerWidth > 640,
      path: location.pathname,
      navigate: (path: string) => history.replaceState({}, "", path),
    },
  ) {
    this.state = initialState(mode, environment.path);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(patch: Partial<Snapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
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
      });
      if (this.disposed) return;
      this.patch({ connected: true, loginRequired: false });
      await this.refresh();
      if (this.disposed) return;
      this.transport.watch();
      if (this.transport.embedded && !this.transport.preview) this.schedule();
    } catch (error) {
      if (!this.state.connected) {
        this.patch({ connection: "Connection failed" });
      } else if (this.transport.embedded && !this.transport.preview) {
        // Keep the panel polling when its first host read fails transiently.
        this.schedule();
      }
      this.report(error);
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.disposed) return;
    this.timer = setTimeout(
      async () => {
        try {
          if (!this.environment.hidden() && !this.state.busy)
            await this.refresh();
        } catch (error) {
          this.report(error);
        } finally {
          if (!this.disposed) this.schedule();
        }
      },
      this.state.mode === "panel" ? 5000 : 3000,
    );
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
      if (this.state.mode === "panel") {
        const projects = await this.tool<Project[]>("list_agent_projects");
        if (this.disposed || version !== this.state.scopeVersion) return;
        this.patch({ projects });
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
        this.patch({ events: [], artifacts: [], selectedArtifact: undefined });
      }
      if (
        !selected &&
        !this.state.workerRoute &&
        !this.browsing &&
        tasks.length &&
        (this.state.mode === "console" ||
          this.environment.wide() ||
          conversation ||
          repository)
      ) {
        selected =
          tasks.find((task) => task.pending_input)?.id ??
          tasks.find((task) => !terminal(task))?.id ??
          tasks[0].id;
        this.patch({
          tab:
            this.state.mode === "console"
              ? this.state.tab
              : tasks.find((task) => task.id === selected)?.result
                ? "result"
                : "activity",
        });
      }
      this.patch({ tasks, selected });
      await this.loadDetail();
      if (this.disposed || version !== this.state.scopeVersion) return;
      this.patch({
        connection: this.transport.preview
          ? "Fixture preview"
          : this.state.mode === "console"
            ? "● Connected"
            : "Connected · refreshes every 5s",
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
    if (!id || this.state.workerRoute || this.disposed) return;
    const [events, artifacts] = await Promise.all([
      readEventTail(
        id,
        this.state.events,
        (after) => this.tool("get_agent_events", { task_id: id, after }),
        () => !this.disposed && generation === this.generation,
      ),
      this.tool<Artifact[]>("get_agent_artifacts", { task_id: id }),
    ]);
    if (
      this.disposed ||
      id !== this.state.selected ||
      generation !== this.generation
    )
      return;
    this.patch({ events, artifacts });
  }
  async select(id: string) {
    this.explicitSelection = true;
    this.browsing = false;
    ++this.generation;
    this.patch({
      selected: id,
      selectedArtifact: undefined,
      workerRoute: undefined,
      events: [],
      artifacts: [],
      tab:
        this.state.mode === "console"
          ? "activity"
          : this.state.tasks.find((task) => task.id === id)?.result
            ? "result"
            : "activity",
    });
    this.navigate(`/tasks/${id}`);
    await this.loadDetail();
    await this.share();
  }
  back() {
    this.explicitSelection = false;
    this.browsing = true;
    ++this.generation;
    this.patch({ selected: undefined, events: [], artifacts: [] });
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
  }
  async chooseWorker(workerRoute?: string) {
    ++this.generation;
    this.browsing = false;
    this.patch({
      workerRoute,
      selected: undefined,
      selectedArtifact: undefined,
      events: [],
      artifacts: [],
    });
    this.navigate(workerRoute ? `/workers/${workerRoute}` : "/");
    await this.refresh();
    await this.share();
  }
  private navigate(path: string) {
    if (
      this.state.mode === "console" &&
      !this.transport.embedded &&
      !this.transport.preview
    )
      this.environment.navigate(path);
  }
  selectArtifact(id?: string) {
    this.patch({ selectedArtifact: id, tab: "changes" });
    this.navigate(
      `/tasks/${this.state.selected}${id ? `/artifacts/${id}` : ""}`,
    );
    this.run(() => this.share(id));
  }
  async share(artifactId?: string) {
    if (this.disposed || !this.state.host.canShare) return;
    const task = selectedTask(this.state);
    await this.transport.share?.({
      selected_worker: this.state.workerRoute ?? null,
      selected_task: this.state.selected ?? null,
      selected_artifact: artifactId ?? null,
      conversation_id: this.state.conversation ?? null,
      repository: task?.repository ?? this.state.repository ?? null,
      revision: task?.revision ?? this.state.revision,
    });
  }
  private invalidateScope(patch: Partial<Snapshot>) {
    ++this.generation;
    this.explicitSelection = false;
    this.browsing = false;
    this.patch({
      ...patch,
      scopeVersion: this.state.scopeVersion + 1,
      tasks: [],
      selected: undefined,
      selectedArtifact: undefined,
      events: [],
      artifacts: [],
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
    if (Array.isArray(data?.tasks))
      this.patch({
        tasks: data.tasks.filter(
          (task) =>
            (!conversation || task.conversation_id === conversation) &&
            (!repository || task.repository === repository),
        ),
      });
    if (typeof data?.panel_selection?.task_id === "string") {
      ++this.generation;
      this.explicitSelection = true;
      this.browsing = false;
      this.patch({
        selected: data.panel_selection.task_id,
        events: [],
        artifacts: [],
        tab: data.panel_selection.tab === "result" ? "result" : "activity",
        filter: "all",
        search: "",
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
      filter: "all",
      search: "",
    });
    await this.refresh();
    await this.share();
  }
  async settings() {
    if (this.state.dialog || this.state.busy) return;
    const scope = this.state.scopeVersion;
    const settings = await this.tool<SettingsDocument>("get_agent_settings");
    if (this.disposed || scope !== this.state.scopeVersion || this.state.dialog)
      return;
    if (!settings.schema?.properties)
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
      | Omit<Extract<DialogState, { kind: "control" }>, "scope">
      | Omit<
          Extract<DialogState, { kind: "respond" | "handoff" | "workspace" }>,
          "scope"
        >
      | Omit<Extract<DialogState, { kind: "artifact" }>, "scope">,
  ) {
    if (this.state.dialog || this.state.busy) return;
    this.patch({
      dialog: { ...dialog, scope: this.state.scopeVersion } as DialogState,
      formError: "",
    });
    if (dialog.kind === "artifact")
      this.run(() => this.share(dialog.artifact.id));
  }
  dismiss() {
    if (!this.state.busy) this.patch({ dialog: undefined, formError: "" });
  }
  /** All mutations/messages are bound to the scope visible when the dialog opened. */
  async submit(operation: () => Promise<Task | void>, selectReturned = false) {
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
          workerRoute: undefined,
          selectedArtifact: undefined,
          events: [],
          artifacts: [],
          tab: "activity",
          ...(this.state.mode === "panel"
            ? { repository: task.repository, revision: task.revision }
            : {}),
        });
        this.navigate(`/tasks/${task.id}`);
      }
      this.patch({ dialog: undefined });
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
