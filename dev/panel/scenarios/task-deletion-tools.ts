import type { TaskDeletionPreview } from "../../../src/shared/tasks/deletion-contract.js";
import type { Task } from "../../../src/shared/tasks/model.js";

/**
 * Mirrors the service's session rule. Fixture sessions have no local files
 * that the browser can verify, so any recorded session blocks session cleanup.
 */
export function previewTaskDeletion(
  tasks: Task[],
  args: Record<string, unknown>,
): TaskDeletionPreview {
  const ids = Array.isArray(args.task_ids) ? args.task_ids : [];

  const repository =
    typeof args.repository === "string" ? args.repository : undefined;

  const includeSession = args.delete_agent_task === true;

  const selected = tasks.filter((task) =>
    repository ? task.repository === repository : ids.includes(task.id),
  );

  const recorded = selected.find((task) => task.session_id);

  const unrecorded =
    selected.length === 1
      ? "This task has no recorded provider session."
      : "No selected task has a recorded provider session.";

  return {
    tasks: selected.map((task) => ({
      id: task.id,
      title: task.title,
      repository: task.repository,
      ...(task.workspace_strategy === "worktree"
        ? { worktree: task.workspace, branch: task.branch }
        : {}),
      ...(!task.session_id ? { sessionRecorded: false as const } : {}),
    })),
    includeSession,
    ...(repository ? { project: repository } : {}),
    sessionDeletion: {
      available: false,
      message: recorded
        ? `Session files cannot be verified in the preview. Task: ${recorded.title}`
        : unrecorded,
    },
    ...(!includeSession ? { confirmation: "0".repeat(64) } : {}),
  };
}
