import type { Task } from "../../../src/shared/tasks/model";
import { previewEvents, previewStreamingDraft } from "./fixtures";
import { liveConversationSnapshot } from "./live-conversation";

const startedAt = Date.now();

/** One clock sample for all the live task, activity, chat and draft reads in a tool call. */
export function livePreview() {
  const elapsed = Date.now() - startedAt;
  const live = liveConversationSnapshot(elapsed);

  const taskFor = (task: Task): Task =>
    task.id === live.task.id
      ? {
          ...task,
          status: live.task.status,
          turn: live.task.turn,
          run_started_at: live.task.run_started_at,
          updated_at: live.task.updated_at,
        }
      : task;

  const eventsFor = (id: unknown) =>
    id === live.task.id
      ? live.events
      : previewEvents.filter((event) => event.task_id === id);

  const draftFor = (id: unknown) => {
    if (id === live.task.id) return live.draft;
    if (id !== previewStreamingDraft.taskId) return undefined;
    const { messageId, text } = previewStreamingDraft;
    // The standalone streaming fixture grows at 60 characters per second, then pauses and restarts.
    const length = (elapsed / 1000) * 60;

    return {
      message_id: messageId,
      text: text.slice(
        0,
        Math.max(1, Math.round(length % (text.length + 300))),
      ),
    };
  };

  return { taskFor, eventsFor, draftFor, revision: live.revision };
}
