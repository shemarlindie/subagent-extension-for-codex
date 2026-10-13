import {
  parentMessageId,
  type ParentMessageNotification,
} from "../../../../shared/tasks/conversation/messages.js";
import { PARENT_REPORT_PROTOCOL } from "../../../../shared/tasks/conversation/parent-protocol.js";
import type { Store } from "../storage/store.js";

/** Claim once before calling the host: ambiguous failures must not resend automatically. */
export function claimParentMessage(
  store: Store,
  owner: string,
  conversation: string,
): ParentMessageNotification | null {
  return store.transaction(() => {
    const event = store.pendingParentMessage(owner, conversation);
    if (!event) return null;
    const task = store.get(event.task_id, owner);

    const attempt = store.event(task, "parent.message_attempted", {
      message_id: event.id,
    });

    const messageId = parentMessageId(event.id);

    return {
      task_id: task.id,
      attempt_id: attempt.id,
      message_id: messageId,
      conversation_id: conversation,
      text: `Delegated worker message available. Task ID: ${task.id}. Message ID: ${messageId}. Retrieve with get_agent_message(${JSON.stringify({ task_id: task.id, message_id: messageId })}) unless already processed. ${PARENT_REPORT_PROTOCOL}`,
    };
  });
}

export function recordParentDelivery(
  store: Store,
  owner: string,
  taskId: string,
  attemptId: number,
  conversation: string,
  delivered: boolean,
  error?: string,
  skipped?: "acknowledged",
) {
  const task = store.get(taskId, owner);

  if (skipped && (delivered || error)) {
    throw new Error("Skipped delivery cannot be accepted or failed");
  }

  if (task.conversation_id !== conversation) {
    throw new Error("Parent conversation mismatch");
  }

  const events = store.eventsOfTypes(task.id, [
    "parent.message_attempted",
    "parent.message_delivery",
  ]);

  if (
    !events.some(
      (event) =>
        event.id === attemptId && event.type === "parent.message_attempted",
    )
  ) {
    throw new Error("Parent message attempt not found");
  }

  if (
    events.some(
      (event) =>
        event.type === "parent.message_delivery" &&
        event.data.attempt_id === attemptId,
    )
  ) {
    return;
  }

  store.event(task, "parent.message_delivery", {
    attempt_id: attemptId,
    delivered,
    ...(skipped ? { skipped } : {}),
    ...(error ? { error } : {}),
  });
}

/** Acknowledgement follows processing; reads and delivery attempts never imply it. */
export function acknowledgeParentMessage(
  store: Store,
  owner: string,
  taskId: string,
  messageId: string,
) {
  return store.transaction(() => {
    const task = store.get(taskId, owner);

    const events = store.eventsOfTypes(task.id, [
      "parent.message",
      "parent.message_acknowledged",
    ]);

    const report = events.find(
      (event) =>
        event.type === "parent.message" &&
        parentMessageId(event.id) === messageId,
    );

    if (!report) throw new Error("Parent message not found");

    const alreadyAcknowledged = events.some(
      (event) =>
        event.type === "parent.message_acknowledged" &&
        event.data.message_id === report.id,
    );

    if (!alreadyAcknowledged) {
      store.event(task, "parent.message_acknowledged", {
        message_id: report.id,
      });
    }

    return {
      task_id: task.id,
      message_id: messageId,
      acknowledged: true,
      already_acknowledged: alreadyAcknowledged,
    };
  });
}
