import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { Notice } from "../../../../shared/components/notice/notice";
import { workspaceFallbackReason } from "../../workspace-fallback";
import { useDismissedNotices } from "./dismissed-notices";

/** Warns that a task lost the worktree its user's default asked for. */
export function WorkspaceFallbackNotice({ task }: { task: Task }) {
  const [dismissed, dismiss] = useDismissedNotices(),
    reason = workspaceFallbackReason(task);

  if (!reason || dismissed.has(task.id)) return null;

  return (
    <Notice className="workspace-fallback-notice">
      <p>{reason}</p>
      <Button variant="text" onClick={() => dismiss(task.id)}>
        Dismiss
      </Button>
    </Notice>
  );
}
