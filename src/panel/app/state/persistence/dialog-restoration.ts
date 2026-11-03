import { pendingInputKind } from "../../../../shared/tasks/model";
import type { DialogState, PersistedDialog, Snapshot, Task } from "../types";

// Settings and delegation restore through their loaders, which own async reads.
type RestorableDialog = Exclude<
  PersistedDialog,
  { kind: "settings" | "delegate" }
>;

/** Recreates a saved dialog from the panel's freshly loaded projects and tasks. */
export function restoreDialog(
  saved: RestorableDialog,
  tasks: Task[],
  scope: number,
  state: Snapshot,
): DialogState | undefined {
  if (saved.kind === "remove-project") {
    const project = state.projects.find(
      (item) => item.repository === saved.repository,
    );

    if (state.conversation || state.page !== "projects" || !project) return;

    return { kind: saved.kind, project, scope };
  }

  if (saved.kind === "pending-updates") {
    return state.conversation ? { kind: saved.kind, scope } : undefined;
  }

  if (saved.kind === "project") {
    return {
      kind: saved.kind,
      repository: saved.repository,
      ...(saved.forNewTask ? { forNewTask: true } : {}),
      scope,
    };
  }

  const task = tasks.find((item) => item.id === saved.taskId);
  if (!task) return;

  switch (saved.kind) {
    case "respond":
      if (
        !task.pending_input ||
        pendingInputKind(task.pending_input) === "question" ||
        (saved.requestId && task.pending_input.id !== saved.requestId)
      ) {
        return;
      }

      return { kind: saved.kind, task, scope };
    case "handoff":
      return { kind: saved.kind, task, target: saved.target, scope };
    case "delete":
      return { kind: saved.kind, task, scope };
    case "file":
      return { kind: saved.kind, task, path: saved.path, scope };
    case "worktree":
      return {
        kind: saved.kind,
        action: saved.action,
        task,
        files: saved.files,
        scope,
      };
  }
}
