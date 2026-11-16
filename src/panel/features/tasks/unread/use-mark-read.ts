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
  const controller = useController();
  const visible = useDocumentVisible();
  const unread = controller.taskActions.unread;
  const taskId = task?.id;

  const chatShown = useSnapshot(
    (state) => state.page === "tasks" && state.tab === "chat",
  );

  const showing = ready && visible && chatShown;

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

  // On screen at the latest message: mark the task read through Chat's
  // cursor, and again as messages arrive. The cursor is read through a store
  // subscription, so new messages don't render the caller. UnreadActions sends
  // each cursor once, so repeated calls don't repeat it.
  useEffect(() => {
    if (!task || !showing || !atLatest) return;

    const read = () => {
      const { chat } = controller.getSnapshot();
      const cursor = chat?.task === task.id ? chat.cursor : undefined;

      if (cursor !== undefined) {
        controller.run(() => unread.readThrough(task, cursor));
      }
    };

    read();
    const unsubscribe = controller.subscribe(read);

    return () => {
      unsubscribe();
    };
  }, [controller, unread, task, showing, atLatest]);
}
