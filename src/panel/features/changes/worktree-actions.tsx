import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import type { Task } from "../tasks/types";
import type { ChangesState } from "./types";

type WorktreeActionsProps = {
  task: Task;
  changes?: ChangesState;
};

/** States in which a task is running or about to, so its worktree is in use. */
const ACTIVE = ["queued", "starting", "running", "waiting"];

/**
 * Remove worktree, then Delete branch once it is gone, for a worktree task.
 * Which one shows follows the task's last read changes.
 */
export function WorktreeActions({ task, changes }: WorktreeActionsProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    state = changes?.data?.state;

  if (task.workspace_strategy !== "worktree" || !task.branch || !changes?.data)
    return null;
  if (state === "branch_deleted") return null;

  const running = ACTIVE.includes(task.status),
    disabled = busy || running || changes.loading || Boolean(changes.error);

  return (
    <div className="worktree-actions">
      {state === "workspace_missing" ? (
        <Button
          disabled={disabled}
          onClick={() =>
            controller.open({ kind: "worktree", action: "delete-branch", task })
          }
        >
          Delete branch
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
