import type { ProjectGit } from "../projects/types";

type WorkspaceNoteInput = {
  git?: ProjectGit;
  savedStrategy?: string;
  readOnly: boolean;
};

/**
 * What a writing task should know before it edits a project with no commit. It
 * warns when the user's worktree default can't apply, since isolation is lost.
 */
export function workspaceNote({
  git,
  savedStrategy,
  readOnly,
}: WorkspaceNoteInput) {
  if (readOnly || (git !== "none" && git !== "no_commits")) return undefined;

  if (savedStrategy === "worktree") {
    return {
      warning: true,
      message:
        git === "none"
          ? "Your default is a worktree, but this folder has no Git. This task will edit the folder directly, and edits can't be undone with Git."
          : "Your default is a worktree, but this repository has no commits. This task will edit the folder directly.",
    };
  }

  return {
    warning: false,
    message:
      git === "none"
        ? "This folder has no Git. Edits apply directly and can't be undone with Git."
        : "No commits yet, so this task edits the folder directly.",
  };
}
