import { pendingInputKind } from "../../../../shared/tasks/model";
import { delegationDialog } from "../../../features/delegation/delegation";
import type {
  Defaults,
  DialogState,
  PersistedDialog,
  SettingsDocument,
  Snapshot,
  Task,
} from "../types";

interface RestorationContext {
  snapshot(): Snapshot;
  active(): boolean;
  explicitSelection: boolean;
  tool<T>(name: string): Promise<T>;
}

/** Reads fresh server data before recreating a persisted dialog descriptor. */
export function restoreDialog(
  saved: PersistedDialog,
  tasks: Task[],
  scope: number,
  context: RestorationContext,
): DialogState | undefined | Promise<DialogState | undefined> {
  const task =
    "taskId" in saved
      ? tasks.find((item) => item.id === saved.taskId)
      : undefined;

  let dialog: DialogState | undefined;

  switch (saved.kind) {
    case "remove-project": {
      const state = context.snapshot();

      const project = state.projects.find(
        (item) => item.repository === saved.repository,
      );

      if (state.conversation || state.page !== "projects" || !project) return;

      return { kind: saved.kind, project, scope };
    }

    case "project":
      dialog = {
        kind: "project",
        repository: saved.repository,
        scope,
      };

      break;

    case "settings": {
      return (async () => {
        const settings = await context.tool<SettingsDocument>("get_settings");

        if (!context.active()) return;

        if (!Array.isArray(settings.sections)) {
          return;
        }

        dialog = { kind: "settings", settings, scope };

        return dialog;
      })();
    }

    case "delegate": {
      return (async () => {
        const { values: defaults } = await context.tool<{ values: Defaults }>(
          "get_settings",
        );

        if (!context.active()) return;

        const base = delegationDialog(
          { ...context.snapshot(), tasks },
          context.snapshot().projects,
          defaults,
          context.explicitSelection,
          saved.preferredWorker,
        );

        dialog = {
          ...base,
          repository: saved.repository ?? base.repository,
          revision: saved.revision ?? base.revision,
        };

        return dialog;
      })();
    }

    case "respond":
      if (
        !task!.pending_input ||
        pendingInputKind(task!.pending_input) === "question" ||
        (saved.requestId && task!.pending_input.id !== saved.requestId)
      ) {
        return;
      }

      dialog = { kind: saved.kind, task: task!, scope };
      break;
    case "handoff":
      dialog = { kind: saved.kind, task: task!, target: saved.target, scope };
      break;
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

  return dialog;
}
