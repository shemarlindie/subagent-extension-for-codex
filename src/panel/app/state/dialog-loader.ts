import { delegationDialog } from "../../features/delegation/delegation";
import { errorMessage } from "../../shared/utils/error-message";
import type {
  Defaults,
  DelegateDialogRead,
  DialogReadStatus,
  DialogState,
  Project,
  SettingsDocument,
  Snapshot,
  Worker,
} from "./types";

type SettingsLoading = Extract<DialogState, { kind: "settings-loading" }>;

type DelegateLoading = Extract<DialogState, { kind: "delegate-loading" }>;

interface DialogLoaderContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string): Promise<T>;
  readProjects(): Promise<Project[]>;
  /** Reads workers and records when they were read. */
  readWorkers(): Promise<Worker[]>;
  explicitSelection(): boolean;
  /** Retries the panel context read through the next refresh. */
  refresh(): void;
}

interface DelegateReadResult {
  defaults?: Defaults;
  snapshot?: Partial<Snapshot>;
}

/**
 * Opens the settings and New Task dialogs while their reads load, then fills
 * them in. Each opening or retry gets a request number, so a late read for an
 * older one is dropped.
 */
export class DialogLoader {
  private request = 0;

  constructor(private context: DialogLoaderContext) {}

  openSettings() {
    const dialog = {
      kind: "settings-loading" as const,
      scope: this.context.snapshot().scopeVersion,
      request: ++this.request,
      status: "loading" as const,
    };

    this.context.patch({ dialog, formError: "" });
    void this.loadSettings(dialog);
  }

  openDelegate(
    preferredWorker?: string,
    repository?: string,
    revision?: string,
  ) {
    const state = this.context.snapshot();

    const dialog = {
      kind: "delegate-loading" as const,
      scope: state.scopeVersion,
      request: ++this.request,
      preferredWorker,
      ...(repository ? { repository } : {}),
      ...(revision ? { revision } : {}),
      statuses: {
        context: state.scopeKnown ? "ready" : "loading",
        settings: "loading",
        projects: state.projectsLoaded ? "ready" : "loading",
        workers: state.workersLoaded ? "ready" : "loading",
      } satisfies Record<DelegateDialogRead, DialogReadStatus>,
    };

    this.context.patch({ dialog, formError: "" });
    this.loadDelegate(dialog);
  }

  /** Retries the open loading dialog's failed reads. */
  retry() {
    const dialog = this.context.snapshot().dialog;

    if (dialog?.kind === "settings-loading" && dialog.status === "error") {
      const retry = {
        ...dialog,
        scope: this.context.snapshot().scopeVersion,
        request: ++this.request,
        status: "loading" as const,
        error: undefined,
      };

      this.context.patch({ dialog: retry });
      void this.loadSettings(retry);

      return;
    }

    if (dialog?.kind === "delegate-loading") this.retryDelegate(dialog);
  }

  /**
   * Records one of the New Task dialog's reads, and replaces the dialog with
   * the loaded form once every read is ready.
   */
  updateDelegateRead(
    request: number,
    resource: DelegateDialogRead,
    status: DialogReadStatus,
    result?: DelegateReadResult,
    error?: unknown,
  ) {
    const current = this.context.snapshot().dialog;

    if (
      this.context.closed() ||
      current?.kind !== "delegate-loading" ||
      current.request !== request
    ) {
      return;
    }

    const errors = { ...current.errors };

    if (status === "error") errors[resource] = errorMessage(error);
    else delete errors[resource];

    const updated = {
      ...current,
      statuses: { ...current.statuses, [resource]: status },
      errors,
      ...(result && "defaults" in result ? { defaults: result.defaults } : {}),
    };

    this.context.patch({ ...result?.snapshot, dialog: updated });

    if (
      Object.values(updated.statuses).every((item) => item === "ready") &&
      updated.defaults
    ) {
      this.finishDelegate(updated, updated.defaults);
    }
  }

  private async loadSettings(dialog: SettingsLoading) {
    try {
      const settings =
        await this.context.tool<SettingsDocument>("get_agent_settings");

      if (!this.isSettingsRequest(dialog.request)) return;

      if (!Array.isArray(settings.sections)) {
        throw new Error(
          "Settings are unavailable in this preview or service version.",
        );
      }

      this.context.patch({
        dialog: {
          kind: "settings",
          settings,
          scope: this.context.snapshot().scopeVersion,
        },
        formError: "",
      });
    } catch (error) {
      const current = this.context.snapshot().dialog;
      if (!this.isSettingsRequest(dialog.request)) return;

      this.context.patch({
        dialog: {
          ...(current as SettingsLoading),
          scope: this.context.snapshot().scopeVersion,
          status: "error",
          error: errorMessage(error),
        },
      });
    }
  }

  private isSettingsRequest(request: number) {
    const dialog = this.context.snapshot().dialog;

    return (
      !this.context.closed() &&
      dialog?.kind === "settings-loading" &&
      dialog.request === request
    );
  }

  /** Starts the New Task dialog's reads that are still loading. */
  private loadDelegate(dialog: DelegateLoading) {
    const { request, statuses } = dialog;

    const failed = (resource: DelegateDialogRead) => (error: unknown) =>
      this.updateDelegateRead(request, resource, "error", undefined, error);

    if (statuses.settings === "loading") {
      void this.context.tool<{ values: Defaults }>("get_agent_settings").then(
        ({ values }) =>
          this.updateDelegateRead(request, "settings", "ready", {
            defaults: values,
          }),
        failed("settings"),
      );
    }

    if (statuses.projects === "loading") {
      void this.context.readProjects().then(
        (projects) =>
          this.updateDelegateRead(request, "projects", "ready", {
            snapshot: { projects, projectsLoaded: true },
          }),
        failed("projects"),
      );
    }

    if (statuses.workers === "loading") {
      void this.context.readWorkers().then(
        (workers) =>
          this.updateDelegateRead(request, "workers", "ready", {
            snapshot: { workers, workersLoaded: true },
          }),
        failed("workers"),
      );
    }
  }

  /** Replaces a fully read loading dialog with the New Task form. */
  private finishDelegate(dialog: DelegateLoading, defaults: Defaults) {
    const state = this.context.snapshot();

    try {
      const resolved = delegationDialog(
        state,
        state.projects,
        defaults,
        this.context.explicitSelection(),
        dialog.preferredWorker,
      );

      this.context.patch({
        dialog: {
          ...resolved,
          scope: dialog.scope,
          repository: dialog.repository ?? resolved.repository,
          revision: dialog.revision ?? resolved.revision,
        },
      });
    } catch (loadError) {
      const active = this.context.snapshot().dialog;

      if (
        active?.kind === "delegate-loading" &&
        active.request === dialog.request
      ) {
        this.context.patch({
          dialog: { ...active, message: errorMessage(loadError) },
        });
      }
    }
  }

  private retryDelegate(dialog: DelegateLoading) {
    const statuses = { ...dialog.statuses };
    const errors = { ...dialog.errors };
    const retryContext = statuses.context === "error";

    for (const resource of [
      "context",
      "settings",
      "projects",
      "workers",
    ] as const) {
      if (statuses[resource] !== "error") continue;
      statuses[resource] = "loading";
      delete errors[resource];
    }

    const retry = {
      ...dialog,
      request: ++this.request,
      statuses,
      errors,
      message: undefined,
    };

    this.context.patch({ dialog: retry });
    this.loadDelegate(retry);
    if (retryContext) this.context.refresh();
  }
}
