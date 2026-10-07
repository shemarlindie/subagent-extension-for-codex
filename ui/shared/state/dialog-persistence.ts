import type {
  ControlAction,
  DialogState,
  PersistedDialog,
  PersistedDialogDraft,
} from "./types";

const controlActions = ["steer", "continue", "interrupt"] as const;

export const persistedDialogIds = [
  "project",
  "settings",
  "delegate",
  "steer",
  "continue",
  "interrupt",
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

function draftOf(
  value: Record<string, unknown>,
): PersistedDialogDraft | undefined {
  return isRecord(value.draft) ? value.draft : undefined;
}

/** Store only stable dialog identity and user-entered draft, never server data. */
export function persistDialog(dialog: DialogState): PersistedDialog {
  switch (dialog.kind) {
    case "project":
      return { kind: dialog.kind, repository: dialog.repository };
    case "settings":
      return { kind: dialog.kind };
    case "delegate":
      return {
        kind: dialog.kind,
        preferredWorker: dialog.preferredWorker,
        repository: dialog.repository,
        revision: dialog.revision,
      };
    case "control":
      return {
        kind: dialog.kind,
        action: dialog.action,
        taskId: dialog.task.id,
      };
    case "respond":
      return {
        kind: dialog.kind,
        taskId: dialog.task.id,
        requestId: dialog.task.pending_input?.id,
      };
    case "handoff":
      return { kind: dialog.kind, taskId: dialog.task.id };
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

/** Parse and narrow local-storage data so stale or edited values are harmless. */
export function parsePersistedDialog(
  value: unknown,
): PersistedDialog | undefined {
  if (!isRecord(value) || !isString(value.kind)) return;

  const draft = draftOf(value);

  switch (value.kind) {
    case "project":
      return {
        kind: value.kind,
        ...(isString(value.repository) ? { repository: value.repository } : {}),
        ...(draft ? { draft } : {}),
      };
    case "settings":
      return { kind: value.kind, ...(draft ? { draft } : {}) };
    case "delegate":
      return {
        kind: value.kind,
        ...(isString(value.preferredWorker)
          ? { preferredWorker: value.preferredWorker }
          : {}),
        ...(isString(value.repository) ? { repository: value.repository } : {}),
        ...(isString(value.revision) ? { revision: value.revision } : {}),
        ...(draft ? { draft } : {}),
      };
    case "control":
      if (
        !controlActions.includes(
          value.action as (typeof controlActions)[number],
        ) ||
        !isString(value.taskId) ||
        !value.taskId
      )
        return;

      return {
        kind: value.kind,
        action: value.action as ControlAction,
        taskId: value.taskId,
        ...(draft ? { draft } : {}),
      };
    case "respond":
      if (!isString(value.taskId) || !value.taskId) return;

      return {
        kind: value.kind,
        taskId: value.taskId,
        ...(isString(value.requestId) ? { requestId: value.requestId } : {}),
        ...(draft ? { draft } : {}),
      };
    case "handoff":
    case "delete":
      if (!isString(value.taskId) || !value.taskId) return;

      return {
        kind: value.kind,
        taskId: value.taskId,
        ...(draft ? { draft } : {}),
      };
    case "file":
      if (!isString(value.taskId) || !value.taskId || !isString(value.path))
        return;

      return {
        kind: value.kind,
        taskId: value.taskId,
        path: value.path,
        ...(draft ? { draft } : {}),
      };
    case "worktree":
      if (
        !isString(value.taskId) ||
        !value.taskId ||
        (value.action !== "remove" && value.action !== "delete-branch") ||
        (value.files !== undefined &&
          (!Array.isArray(value.files) || !value.files.every(isString)))
      )
        return;

      return {
        kind: value.kind,
        taskId: value.taskId,
        action: value.action,
        ...(Array.isArray(value.files) ? { files: value.files } : {}),
        ...(draft ? { draft } : {}),
      };
    default:
      return;
  }
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
    case "control":
      return dialog.action;
    case "respond":
      return "permission";
    case "delete":
      return "delete_task";
    case "worktree":
      return dialog.action === "remove"
        ? "worktree_remove"
        : "worktree_delete_branch";
    default:
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
