import { useState } from "react";

import { useSnapshot } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { newMessagesIndex } from "./new-messages";

/** The "New" divider's marker, taken when the task opens and checked once Chat loads. */
type OpenedChat = { newFrom?: number; loaded?: true };

/**
 * The newest event the user had seen when an unseen task opened, which
 * Chat's "New" divider follows while the task stays open; undefined without
 * a divider. Chat remounts for each task, so the marker is taken once,
 * before Chat sees the task and the task stops being unseen.
 */
export function useNewMessagesFrom(task: Task | undefined, ready: boolean) {
  const state = useSnapshot();
  const [opened, setOpened] = useState<OpenedChat>();

  // The service sends a marker with every unseen task. Only a task the user
  // just marked unseen lacks one until the service answers, and it has
  // nothing new, so it gets no divider.
  if (!opened && task) {
    setOpened({ newFrom: task.unseen ? task.seen_through : undefined });
  }

  // Once Chat loads, keep the divider only if something new follows the
  // marker. Otherwise a reply arriving later would add a divider and move
  // the reader to it.
  if (opened && !opened.loaded && ready && state.chat) {
    const from = opened.newFrom;

    const found =
      from !== undefined &&
      newMessagesIndex(state.chat.items, from) !== undefined;

    setOpened({ loaded: true, newFrom: found ? from : undefined });
  }

  return opened?.loaded ? opened.newFrom : undefined;
}
