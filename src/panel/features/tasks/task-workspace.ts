import type { Task } from "../../app/state/types";

/** Why a task that should have had a worktree edits its project directly. */
export function workspaceFallbackReason({ workspace_fallback }: Task) {
  if (workspace_fallback === "no_git") {
    return "Not isolated in a worktree. This folder has no Git, so edits apply directly.";
  }

  return workspace_fallback === "no_commits"
    ? "Not isolated in a worktree. This repository has no commits, so edits apply directly."
    : undefined;
}

/** A project-folder task with no commit to start from has no revision to show. */
export const hasRevision = (task: Task) =>
  task.workspace_strategy !== "current_repo" || !!task.base_commit;
