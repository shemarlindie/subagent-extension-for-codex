import { useState } from "react";

import { useSnapshot } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { newMessagesIndex } from "./new-messages";

/** The "New" divider's marker, taken when the task opens and checked once Chat loads. */
type OpenedChat = {
  newFrom?: number;
  loaded?: true;
  /** The last mark from before Chat opened, which must not move the divider. */
  markRevision?: number;
};

/**
 * Where Chat's "New" divider sits, and the request that scrolls to it. The
 * divider is the newest event the user had read when an unread task opened.
 * It moves when the user marks the task unread from one of its messages, and
 * goes when they mark the task read.
 */
export type NewMessages = {
  from?: number;
  /** A new request brings the divider into view. */
  request: number;
  /** A mark scrolls only when the divider is out of view. */
  reveal?: true;
};

/**
 * The newest event the user had read when an unread task opened, which
 * Chat's "New" divider follows while the task stays open; undefined without
 * a divider. Chat remounts for each task, so the marker is taken once,
 * before Chat sees the task and the task stops being unread.
 */
export function useNewMessagesFrom(
  task: Task | undefined,
  ready: boolean,
): NewMessages {
  const state = useSnapshot();
  const [opened, setOpened] = useState<OpenedChat>();

  // The service sends a marker with every unread task. Only a task the user
  // just marked unread lacks one until the service answers, and it has
  // nothing new, so it gets no divider.
  if (!opened && task) {
    setOpened({
      newFrom: task.unread ? task.read_through : undefined,
      markRevision: state.newMark?.revision,
    });
  }

  // Once Chat loads, keep the divider only if something new follows the
  // marker. Otherwise a reply arriving later would add a divider and move
  // the reader to it.
  if (opened && !opened.loaded && ready && state.chat) {
    const from = opened.newFrom;

    const found =
      from !== undefined &&
      newMessagesIndex(state.chat.items, from) !== undefined;

    setOpened({ ...opened, loaded: true, newFrom: found ? from : undefined });
  }

  // A mark made since Chat opened moves the divider to it.
  const mark =
    opened && state.newMark?.task === task?.id ? state.newMark : undefined;

  if (mark && mark.revision !== opened?.markRevision) {
    return { from: mark.through, request: mark.revision, reveal: true };
  }

  return { from: opened?.loaded ? opened.newFrom : undefined, request: 0 };
}
