import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import type { Task } from "../tasks/types";

/** A change read, full or counts, as far as the worktree actions need it. */
type WorktreeRead = {
  loading: boolean;
  error?: string;
  data?: object;
};

type WorktreeActionsProps = {
  task: Task;
  changes?: WorktreeRead;
};

/** States in which a task is running or about to, so its worktree is in use. */
const ACTIVE = ["queued", "starting", "running", "waiting"];

/**
 * Remove worktree, then Delete local branch once it is gone, for a worktree task.
 * Task lifecycle metadata determines which action is available.
 */
export function WorktreeActions({ task, changes }: WorktreeActionsProps) {
  const controller = useController();
  const busy = useSnapshot((state) => state.busy);
  const removed = task.workspace_removed;

  if (
    task.workspace_strategy !== "worktree" ||
    !task.branch ||
    !changes?.data
  ) {
    return null;
  }

  if (task.branch_deleted) return null;

  const running = ACTIVE.includes(task.status),
    disabled = busy || running || changes.loading || Boolean(changes.error);

  return (
    <div className="worktree-actions">
      {removed ? (
        <Button
          disabled={disabled}
          onClick={() =>
            controller.open({ kind: "worktree", action: "delete-branch", task })
          }
        >
          Delete local branch
        </Button>
      ) : (
        <Button
          disabled={disabled}
          onClick={() => controller.run(() => controller.removeWorktree(task))}
        >
          Remove worktree
        </Button>
      )}
      {running && <span className="help">Available once the task stops.</span>}
    </div>
  );
}
