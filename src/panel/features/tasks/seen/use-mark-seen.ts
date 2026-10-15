import { useEffect } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { useDocumentVisible } from "../../../shared/utils/use-document-visible";

type MarkSeenOptions = {
  task?: Task;
  /** Chat has loaded and restored its reading position. */
  ready: boolean;
  /** The reader is at Chat's latest message. */
  atLatest: boolean;
};

/**
 * Sees the open task once its Chat is on screen and read to the latest
 * message, through the newest event Chat has read, and keeps it seen as new
 * messages arrive there. It sees nothing while
 * the panel is hidden, another page or tab is open, or the reader is in
 * Chat's history.
 */
export function useMarkSeen({ task, ready, atLatest }: MarkSeenOptions) {
  const controller = useController(),
    state = useSnapshot(),
    visible = useDocumentVisible(),
    seen = controller.taskActions.seen,
    taskId = task?.id,
    cursor = state.chat?.task === taskId ? state.chat?.cursor : undefined,
    showing =
      ready && visible && state.page === "tasks" && state.tab === "chat";

  // Scrolling to or from the end, or leaving the task, ends a hold from
  // marking it unseen; this runs before the read below.
  useEffect(() => {
    if (!taskId) return;
    seen.release(taskId);

    return () => seen.release(taskId);
  }, [seen, taskId, atLatest]);

  // While on screen at the latest message, list reads keep the task seen
  // instead of flashing it unseen until Chat catches up.
  const watching = showing && atLatest ? taskId : undefined;

  useEffect(() => {
    if (!watching) return;
    seen.watch(watching);

    return () => seen.watch(undefined);
  }, [seen, watching]);

  // On screen at the latest message: see the task through what Chat has
  // read. SeenActions sends each cursor once, so rerenders don't repeat it.
  useEffect(() => {
    if (!task || !showing || !atLatest || cursor === undefined) return;
    controller.run(() => seen.read(task, cursor));
  }, [controller, seen, task, showing, atLatest, cursor]);
}
