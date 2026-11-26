import { selectedTask } from "../../app/state/selectors";
import type { Project, Snapshot, Task } from "../../app/state/types";
import type { UndoRecorder } from "../../app/state/undo-history";
import { errorMessage } from "../../shared/utils/error-message";
import { renamedProject, withoutProject } from "./project-list";
import { mutateProject, type ProjectRemoval } from "./project-mutation";
import { projectUndoSteps } from "./project-undo";

interface ProjectActionContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  refresh(): Promise<void>;
  run(action: () => Promise<unknown>): void;
  report(error: unknown): void;
  /** Marks a project write starting or ending, so views read before it are dropped. */
  projectWrite(): void;
  /** Forgets a removed project in the current and reload-restored view. */
  clearProjectScope(): void;
  closeDialog(): void;
  /** Submits the open dialog, bound to the scope it opened in. */
  submit(operation: () => Promise<Task | void>): Promise<boolean>;
  changeProject(repository: string): Promise<void>;
  /** Hands a project added from the new-task composer back to it. */
  projectAdded(repository: string): void;
  /** Remembers changes the user can undo. */
  undo: UndoRecorder;
}

/** Adds, renames, removes and picks projects. */
export class ProjectActions {
  private undoSteps;

  constructor(private context: ProjectActionContext) {
    this.undoSteps = projectUndoSteps(context);
  }

  // Calls rather than field reads, since an await can replace the state.
  private state() {
    return this.context.snapshot();
  }

  private closed() {
    return this.context.closed();
  }

  private patch(patch: Partial<Snapshot>) {
    this.context.patch(patch);
  }

  /**
   * Opened from the new-task composer, the added project becomes the
   * composer's choice and the task list keeps its scope.
   */
  add(forNewTask = false) {
    const state = this.state();
    if (state.dialog || state.busy || !state.connected) return;

    this.patch({
      dialog: {
        kind: "project",
        repository: state.projectCandidate,
        forNewTask,
        scope: state.scopeVersion,
      },
      formError: "",
    });
  }

  remove(project: Project) {
    const state = this.state();

    if (
      state.page !== "projects" ||
      state.conversation ||
      state.busy ||
      state.dialog ||
      !state.connected
    ) {
      return;
    }

    this.patch({
      dialog: { kind: "remove-project", project, scope: state.scopeVersion },
      formError: "",
    });
  }

  clearError() {
    const state = this.state();
    if (state.page === "projects" && !state.busy) this.patch({ formError: "" });
  }

  /** Project writes are available globally, including their own removal dialog. */
  private canManage(repository: string, name?: string) {
    const state = this.state();
    const { dialog, scopeVersion } = state;

    const removalDialog =
      dialog?.kind === "remove-project" &&
      name === undefined &&
      dialog.project.repository === repository &&
      dialog.scope === scopeVersion;

    return (
      state.page === "projects" &&
      (!dialog || removalDialog) &&
      !state.conversation &&
      !state.busy &&
      !this.closed()
    );
  }

  /** Renames the project, or removes it when `name` is undefined. */
  async manage(
    repository: string,
    name?: string,
    removal: ProjectRemoval = { deleteTasks: false },
  ): Promise<boolean> {
    const { scopeVersion: scope, dialog, projects } = this.state();

    if (!this.canManage(repository, name)) return false;

    const active = () =>
      !this.closed() &&
      this.state().page === "projects" &&
      scope === this.state().scopeVersion &&
      this.state().dialog === dialog;

    this.context.projectWrite();
    this.patch({ busy: true, formError: "" });
    let succeeded = false;
    const before = projects.find((p) => p.repository === repository);

    try {
      const result = await mutateProject(
        this.context,
        repository,
        name,
        removal,
      );

      if (!active()) return false;

      this.patch({
        projects:
          name === undefined
            ? withoutProject(this.state().projects, repository)
            : renamedProject(
                this.state().projects,
                repository,
                result.name ?? name.trim(),
              ),
      });

      succeeded = true;
      if (dialog) this.context.closeDialog();
      const change = this.undoSteps.change(before, name, removal.deleteTasks);
      if (change) this.context.undo.record(change);

      if (name === undefined) {
        this.reconcileRemoval(repository, removal.deleteTasks);
      }
    } catch (error) {
      if (active()) this.patch({ formError: errorMessage(error) });
    } finally {
      this.context.projectWrite();

      if (!this.closed()) {
        this.patch({ busy: false });

        if (scope !== this.state().scopeVersion) {
          if (dialog && this.state().dialog === dialog) {
            this.context.closeDialog();
          }

          this.context.run(() => this.context.refresh());
        }
      }
    }

    // Never retry a mutation. Other panels refresh on the change a successful write makes.
    // Cleanup can fail after deleting some tasks; always reconcile that outcome too.
    await this.context.refresh().catch((error) => this.context.report(error));

    return succeeded;
  }

  /** A removed approval or its deleted selected task returns to the global list. */
  private reconcileRemoval(repository: string, deleteTasks: boolean) {
    const state = this.state();

    if (
      state.repository === repository ||
      (deleteTasks && selectedTask(state)?.repository === repository)
    ) {
      this.patch({ busy: false });
      this.context.clearProjectScope();
    }
  }

  async browse() {
    return this.context.tool<{ repository: string | null }>(
      "app_browse_project",
    );
  }

  /** Picks and registers a project for the open Advanced task dialog. */
  async browseForTask(): Promise<string | undefined> {
    const { dialog, busy, scopeVersion } = this.state();

    if (
      !dialog ||
      dialog.kind !== "delegate" ||
      busy ||
      this.closed() ||
      dialog.scope !== scopeVersion
    ) {
      return;
    }

    const active = () =>
      !this.closed() &&
      this.state().dialog === dialog &&
      dialog.scope === this.state().scopeVersion;

    this.patch({ busy: true, formError: "" });

    try {
      const picked = await this.browse();
      // A picker can outlive its chat; only the original draft may register its selection.
      if (!picked.repository || !active()) return;

      const registered = await this.registerAndList(picked.repository);
      if (!active()) return;
      this.patch({ projects: registered.projects, projectsLoaded: true });

      return registered.repository;
    } catch (error) {
      if (active()) this.patch({ formError: errorMessage(error) });
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
    const registered = await this.context.tool<{ repository: string }>(
      "app_register_project",
      { repository },
    );

    const projects = await this.context.tool<Project[]>("list_projects");

    return { repository: registered.repository, projects };
  }

  /** Add the chat project the user chose in New task before its task starts. */
  async addChatProjectForTask(repository: string) {
    const state = this.state();

    if (
      !state.projectCandidateAuto ||
      repository !== state.projectCandidate ||
      state.projects.some((project) => project.repository === repository)
    ) {
      return;
    }

    const { projects } = await this.registerAndList(repository);

    if (!this.closed()) {
      this.patch({
        projects,
        projectsLoaded: true,
        projectCandidate: undefined,
        projectCandidateAuto: false,
      });
    }
  }

  async register(repository: string) {
    const { scopeVersion: scope, dialog } = this.state();
    const forNewTask = dialog?.kind === "project" && dialog.forNewTask;

    let registered: string | undefined;

    await this.context.submit(async () => {
      const result = await this.registerAndList(repository);
      registered = result.repository;

      if (!this.closed() && scope === this.state().scopeVersion) {
        this.patch({ projects: result.projects, projectsLoaded: true });
      }

      const added = result.projects.find((p) => p.repository === registered);
      if (added) this.context.undo.record(this.undoSteps.addition(added));
    });

    if (
      registered &&
      !this.closed() &&
      scope === this.state().scopeVersion &&
      !this.state().dialog
    ) {
      this.patch({ projectCandidate: undefined, projectCandidateAuto: false });

      if (forNewTask && this.state().newTask) {
        this.context.projectAdded(registered);
      } else if (this.state().page === "tasks") {
        await this.context.changeProject(registered);
      }
    }
  }
}
