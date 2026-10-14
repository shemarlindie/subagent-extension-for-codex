import { delegationDialog } from "../../features/delegation/delegation";
import { errorMessage } from "../../shared/utils/error-message";
import {
  applyDelegateRead,
  type DelegateReadContext,
  type DelegateReadResult,
  delegateReadsReady,
  initialDelegateStatuses,
  retryDelegateStatuses,
  startDelegateReads,
} from "./delegate-reads";
import type {
  Defaults,
  DelegateDialogRead,
  DialogReadStatus,
  DialogState,
  PersistedDialogDraft,
  SettingsDocument,
  Snapshot,
} from "./types";

type SettingsLoading = Extract<DialogState, { kind: "settings-loading" }>;

type DelegateLoading = Extract<DialogState, { kind: "delegate-loading" }>;

interface DialogLoaderContext extends DelegateReadContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  /** Records a draft for a dialog before it opens, so its form starts with it. */
  seedDraft(dialog: DialogState, draft: PersistedDialogDraft): void;
  explicitSelection(): boolean;
  /** Retries the panel context read through the next refresh. */
  refresh(): void;
}

/**
 * Opens the settings and Advanced task dialogs while their reads load, then fills
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

  /** Opens the Advanced task dialog; `draft` prefills its fields. */
  openDelegate(
    preferredWorker?: string,
    repository?: string,
    revision?: string,
    draft?: PersistedDialogDraft,
  ) {
    const state = this.context.snapshot();

    const dialog = {
      kind: "delegate-loading" as const,
      scope: state.scopeVersion,
      request: ++this.request,
      preferredWorker,
      ...(repository ? { repository } : {}),
      ...(revision ? { revision } : {}),
      statuses: initialDelegateStatuses(state),
    };

    if (draft) this.context.seedDraft(dialog, draft);
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

    const updated = applyDelegateRead(current, resource, status, result, error);

    this.context.patch({ ...result?.snapshot, dialog: updated });

    if (delegateReadsReady(updated)) {
      this.finishDelegate(updated, updated.defaults);
    }
  }

  /** Records the panel context read, which the controller's refresh owns. */
  contextRead(status: DialogReadStatus, error?: unknown) {
    const dialog = this.context.snapshot().dialog;

    if (
      dialog?.kind === "delegate-loading" &&
      dialog.statuses.context !== "ready"
    ) {
      this.updateDelegateRead(
        dialog.request,
        "context",
        status,
        undefined,
        error,
      );
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
  private loadDelegate({ request, statuses }: DelegateLoading) {
    startDelegateReads(this.context, statuses, (...update) =>
      this.updateDelegateRead(request, ...update),
    );
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
    const retryContext = dialog.statuses.context === "error";

    const retry = {
      ...retryDelegateStatuses(dialog),
      request: ++this.request,
      message: undefined,
    };

    this.context.patch({ dialog: retry });
    this.loadDelegate(retry);
    if (retryContext) this.context.refresh();
  }
}
