import type { HandoffTarget } from "../../../features/tasks/controls/handoff-message";
import type {
  DialogState,
  PersistedDialog,
  PersistedDialogDraft,
} from "../types";

export const persistedDialogIds = [
  "remove-project",
  "project",
  "settings",
  "delegate",
  "permission",
  "handoff",
  "delete_task",
  "file",
  "worktree_remove",
  "worktree_delete_branch",
] as const;

export type PersistedDialogId = (typeof persistedDialogIds)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function handoffTargetOf(value: unknown): HandoffTarget | undefined {
  if (!isRecord(value)) return;

  if (value.kind === "reply" && isString(value.id) && value.id) {
    return { kind: "reply", id: value.id };
  }

  if (value.kind === "file" && isString(value.path) && value.path) {
    return { kind: "file", path: value.path };
  }

  return undefined;
}

function draftOf(
  value: Record<string, unknown>,
): PersistedDialogDraft | undefined {
  return isRecord(value.draft) ? value.draft : undefined;
}

/** Store only stable dialog identity and user-entered draft, never server data. */
export function persistDialog(dialog: DialogState): PersistedDialog {
  switch (dialog.kind) {
    case "remove-project":
      return { kind: dialog.kind, repository: dialog.project.repository };
    case "project":
      return {
        kind: dialog.kind,
        repository: dialog.repository,
        ...(dialog.forNewTask ? { forNewTask: true } : {}),
      };
    case "settings":
    case "settings-loading":
      return { kind: "settings" };
    case "delegate":
      return {
        kind: dialog.kind,
        preferredWorker: dialog.preferredWorker,
        repository: dialog.repository,
        revision: dialog.revision,
      };
    case "delegate-loading":
      return {
        kind: "delegate",
        preferredWorker: dialog.preferredWorker,
        ...(dialog.repository ? { repository: dialog.repository } : {}),
        ...(dialog.revision ? { revision: dialog.revision } : {}),
      };
    case "respond":
      return {
        kind: dialog.kind,
        taskId: dialog.task.id,
        requestId: dialog.task.pending_input?.id,
      };
    case "handoff":
      return {
        kind: dialog.kind,
        taskId: dialog.task.id,
        ...(dialog.target ? { target: dialog.target } : {}),
      };
    case "delete":
      return { kind: dialog.kind, taskId: dialog.task.id };
    case "file":
      return { kind: dialog.kind, taskId: dialog.task.id, path: dialog.path };
    case "worktree":
      return {
        kind: dialog.kind,
        action: dialog.action,
        taskId: dialog.task.id,
        files: dialog.files,
      };
  }
}

/** Validates dialog identity separately from its editable draft. */
function dialogReference(
  value: Record<string, unknown>,
): PersistedDialog | undefined {
  switch (value.kind) {
    case "remove-project":
      if (!isString(value.repository) || !value.repository) return;

      return { kind: value.kind, repository: value.repository };
    case "project":
      return {
        kind: value.kind,
        ...(isString(value.repository) ? { repository: value.repository } : {}),
        ...(value.forNewTask === true ? { forNewTask: true } : {}),
      };
    case "settings":
      return { kind: value.kind };
    case "delegate":
      return {
        kind: value.kind,
        ...(isString(value.preferredWorker)
          ? { preferredWorker: value.preferredWorker }
          : {}),
        ...(isString(value.repository) ? { repository: value.repository } : {}),
        ...(isString(value.revision) ? { revision: value.revision } : {}),
      };

    default: {
      const taskId = value.taskId;
      if (!isString(taskId) || !taskId) return;

      return taskDialogReference(value, taskId);
    }
  }
}

/** Task-backed dialogs share one required, nonempty task identity. */
function taskDialogReference(
  value: Record<string, unknown>,
  taskId: string,
): PersistedDialog | undefined {
  switch (value.kind) {
    case "respond":
      return {
        kind: value.kind,
        taskId,
        ...(isString(value.requestId) ? { requestId: value.requestId } : {}),
      };

    case "handoff": {
      const target = handoffTargetOf(value.target);
      if (value.target !== undefined && !target) return;

      return {
        kind: value.kind,
        taskId,
        ...(target ? { target } : {}),
      };
    }

    case "delete":
      return { kind: value.kind, taskId };
    case "file":
      if (!isString(value.path)) return;

      return {
        kind: value.kind,
        taskId,
        path: value.path,
      };
    case "worktree":
      if (
        (value.action !== "remove" && value.action !== "delete-branch") ||
        (value.files !== undefined &&
          (!Array.isArray(value.files) || !value.files.every(isString)))
      ) {
        return;
      }

      return {
        kind: value.kind,
        taskId,
        action: value.action,
        ...(Array.isArray(value.files) ? { files: value.files } : {}),
      };
    default:
      return;
  }
}

/** Parse and narrow local-storage data so stale or edited values are harmless. */
export function parsePersistedDialog(
  value: unknown,
): PersistedDialog | undefined {
  if (!isRecord(value)) return;
  const dialog = dialogReference(value);
  if (!dialog || dialog.kind === "remove-project") return dialog;
  const draft = draftOf(value);

  return draft ? { ...dialog, draft } : dialog;
}

/** Keeps the saved dialog stack oldest-to-newest and rejects malformed entries. */
export function parsePersistedDialogs(value: unknown): PersistedDialog[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(parsePersistedDialog)
    .filter((dialog): dialog is PersistedDialog => Boolean(dialog))
    .slice(-8);
}

/** Gives each distinct dialog variant its own short URL flag name. */
export function persistedDialogId(dialog: PersistedDialog): PersistedDialogId {
  switch (dialog.kind) {
    case "respond":
      return "permission";
    case "delete":
      return "delete_task";
    case "worktree":
      return dialog.action === "remove"
        ? "worktree_remove"
        : "worktree_delete_branch";
    case "delegate":
    case "file":
    case "handoff":
    case "project":
    case "remove-project":
    case "settings":
      return dialog.kind;
  }
}

export function sameDialogReference(
  saved: PersistedDialog | undefined,
  current: PersistedDialog,
) {
  if (!saved) return false;

  const reference = (dialog: PersistedDialog) => {
    const { draft: _draft, ...entries } = dialog;

    return JSON.stringify(
      Object.fromEntries(
        Object.entries(entries).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    );
  };

  return reference(saved) === reference(current);
}
