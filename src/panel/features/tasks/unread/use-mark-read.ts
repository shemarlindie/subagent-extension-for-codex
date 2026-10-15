import { useEffect } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { useDocumentVisible } from "../../../shared/utils/use-document-visible";

type MarkReadOptions = {
  task?: Task;
  /** Chat has loaded and restored its reading position. */
  ready: boolean;
  /** The reader is at Chat's latest message. */
  atLatest: boolean;
};

/**
 * Marks the open task read once its Chat is on screen and scrolled to the
 * latest message, through the newest event Chat has shown, and keeps it read
 * as new messages arrive there. It marks nothing while
 * the panel is hidden, another page or tab is open, or the reader is in
 * Chat's history.
 */
export function useMarkRead({ task, ready, atLatest }: MarkReadOptions) {
  const controller = useController(),
    state = useSnapshot(),
    visible = useDocumentVisible(),
    unread = controller.taskActions.unread,
    taskId = task?.id,
    cursor = state.chat?.task === taskId ? state.chat?.cursor : undefined,
    showing =
      ready && visible && state.page === "tasks" && state.tab === "chat";

  // Scrolling to or from the end, or leaving the task, ends a hold from
  // marking it unread; this runs before the read below.
  useEffect(() => {
    if (!taskId) return;
    unread.release(taskId);

    return () => unread.release(taskId);
  }, [unread, taskId, atLatest]);

  // While on screen at the latest message, list fetches keep the task read
  // instead of flashing it unread until Chat catches up.
  const watching = showing && atLatest ? taskId : undefined;

  useEffect(() => {
    if (!watching) return;
    unread.watch(watching);

    return () => unread.watch(undefined);
  }, [unread, watching]);

  // On screen at the latest message: mark the task read through what Chat
  // has shown. UnreadActions sends each cursor once, so rerenders don't repeat it.
  useEffect(() => {
    if (!task || !showing || !atLatest || cursor === undefined) return;
    controller.run(() => unread.readThrough(task, cursor));
  }, [controller, unread, task, showing, atLatest, cursor]);
}
