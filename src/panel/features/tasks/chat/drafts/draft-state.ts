import type { DraftUpdate } from "../../../../../shared/tasks/conversation/drafts.js";

/** The selected task's message being written, as streamed so far. */
export type DraftState = { task: string; message_id: string; text: string };

/**
 * Applies a streamed update to the draft shown. Text continues the draft
 * when it starts where the draft ends, or starts a draft at offset 0; a
 * clear removes it. `stale` means an update was missed, so the draft needs
 * reading in full.
 */
export function applyDraftUpdate(
  current: DraftState | undefined,
  update: DraftUpdate,
): { draft: DraftState | undefined; stale?: boolean } {
  if ("cleared" in update) {
    return {
      draft:
        current?.task === update.task_id &&
        current.message_id === update.message_id
          ? undefined
          : current,
    };
  }

  const same =
    current?.task === update.task_id &&
    current.message_id === update.message_id;

  if (same && update.offset === current.text.length) {
    return { draft: { ...current, text: current.text + update.text } };
  }

  if (update.offset === 0) {
    return {
      draft: {
        task: update.task_id,
        message_id: update.message_id,
        text: update.text,
      },
    };
  }

  return { draft: current, stale: true };
}
