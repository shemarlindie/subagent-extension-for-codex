import type {
  DialogState,
  PersistedDialog,
  PersistedDialogDraft,
  Snapshot,
  Task,
} from "../types";
import { persistDialog, sameDialogReference } from "./dialog-persistence";
import { restoreDialog } from "./dialog-restoration";

interface PersistedDialogsContext {
  snapshot(): Snapshot;
  closed(): boolean;
  /** Saves the view state once the first refresh has restored it. */
  changed(): void;
  /** Saves the view state now. */
  save(): void;
  show(dialog: DialogState): void;
  openSettings(): void;
  openDelegate(
    preferredWorker?: string,
    repository?: string,
    revision?: string,
  ): void;
}

interface SavedDialogs {
  dialogs?: PersistedDialog[];
  lastSettingsSection?: string;
}

/**
 * The dialogs the panel reopens after a reload, oldest first, with their
 * unsent drafts. The last one is the open dialog. Restoring one reads fresh
 * server data, and a dialog whose subject is gone is dropped for the one below.
 */
export class PersistedDialogs {
  private dialogs: PersistedDialog[];
  private settingsSection?: string;

  constructor(
    private context: PersistedDialogsContext,
    saved: SavedDialogs = {},
  ) {
    this.dialogs = saved.dialogs ?? [];

    this.settingsSection = saved.lastSettingsSection;
  }

  latest() {
    return this.dialogs.at(-1);
  }

  /** What the view state saves for dialogs. */
  saved(): SavedDialogs {
    return {
      ...(this.settingsSection
        ? { lastSettingsSection: this.settingsSection }
        : {}),
      ...(this.dialogs.length ? { dialogs: [...this.dialogs] } : {}),
    };
  }

  /**
   * Records a newly shown dialog. The same dialog, or a loading dialog
   * finishing, replaces the latest entry and keeps its draft; any other
   * starts a new stack.
   */
  shown(previous: DialogState | undefined, dialog: DialogState) {
    const descriptor = persistDialog(dialog),
      latest = this.latest(),
      finishingDelegateLoad =
        previous?.kind === "delegate-loading" && dialog.kind === "delegate";

    if (sameDialogReference(latest, descriptor) || finishingDelegateLoad) {
      this.dialogs[this.dialogs.length - 1] = {
        ...descriptor,
        ...(latest?.draft ? { draft: latest.draft } : {}),
      };
    } else {
      this.dialogs = [descriptor];
    }
  }

  /** Opens `dialog` with a seeded draft, above the open dialog when `stack` is set. */
  seed(dialog: DialogState, draft: PersistedDialogDraft, stack: boolean) {
    this.dialogs = [
      ...(stack ? this.dialogs : []),
      { ...persistDialog(dialog), draft },
    ];
  }

  /** Forgets the open dialog. */
  pop() {
    this.dialogs.pop();
  }

  clear() {
    this.dialogs = [];
  }

  draft(kind: PersistedDialog["kind"]) {
    const dialog = this.latest();

    return dialog?.kind === kind ? dialog.draft : undefined;
  }

  lastSettingsSection() {
    return this.settingsSection ?? "task";
  }

  saveSettingsSection(section: string) {
    this.settingsSection = section;
    this.context.changed();
  }

  saveDraft(kind: PersistedDialog["kind"], draft: PersistedDialogDraft) {
    const activeDialog = this.context.snapshot().dialog;
    if (!activeDialog || this.context.closed()) return;

    // Early form fields remain editable and persist while their reads resolve.
    const matchesKind =
      activeDialog.kind === kind ||
      (kind === "settings" && activeDialog.kind === "settings-loading") ||
      (kind === "delegate" && activeDialog.kind === "delegate-loading");

    if (!matchesKind) return;
    const descriptor = this.latest() ?? persistDialog(activeDialog);
    if (descriptor.kind !== kind) return;
    if (!this.dialogs.length) this.dialogs.push(descriptor);

    this.dialogs[this.dialogs.length - 1] = {
      ...descriptor,
      draft: { ...descriptor.draft, ...draft },
    };

    this.context.changed();
  }

  saveField(kind: PersistedDialog["kind"], name: string, value: unknown) {
    this.saveDraft(kind, { [name]: value });
  }

  /** Reopens the latest saved dialog when none is open. */
  restore(tasks: Task[], scope: number) {
    let saved = this.latest();

    while (
      saved &&
      !this.context.closed() &&
      scope === this.context.snapshot().scopeVersion &&
      !this.context.snapshot().dialog
    ) {
      if (saved.kind === "settings") {
        this.context.openSettings();

        return;
      }

      if (saved.kind === "delegate") {
        this.context.openDelegate(
          saved.preferredWorker,
          saved.repository,
          saved.revision,
        );

        return;
      }

      const dialog = restoreDialog(
        saved,
        tasks,
        scope,
        this.context.snapshot(),
      );

      if (dialog) {
        this.context.show(dialog);

        return;
      }

      this.dialogs.pop();
      this.context.save();
      saved = this.latest();
    }
  }
}
