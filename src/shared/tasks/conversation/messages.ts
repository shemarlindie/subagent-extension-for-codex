import type { RequestAttachment } from "../../attachments/model.js";
import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import type { Delivery, Sender, TaskView } from "../model.js";

/** Events a conversation is derived from, besides the task's own request. */
export const MESSAGE_EVENTS = [
  "task.started",
  "task.instruction",
  "agent.message",
  "agent.reply",
];

/** One message in a task's conversation. */
export type ConversationMessage = {
  /**
   * Stable across its life: a sent message's `message_id`, a worker
   * message's SDK message id, `request` for the task's own request.
   */
  id: string;
  /** The event it was last updated by; 0 for the request. */
  event_id: number;
  timestamp: string;
  /** The turn it belongs to. */
  turn: number;
  from: Sender | "worker";
  /** `reply` is the text that ended a successful turn. */
  kind: "request" | "message" | "reply";
  text: string;
  delivery?: Delivery;
  /** A steer the running turn hasn't taken, or one waiting in the queue. */
  state?: "pending_steer" | "queued";
  /** The request's attachments, which Chat reads with the request. */
  attachments?: RequestAttachment[];
};

/** A worker message's SDK id, so its text blocks and draft share it. */
function workerMessageId(e: Event) {
  return eventPayload(e, "agent.message")?.message_id ?? `evt_${e.id}`;
}

/** Text the main worker wrote, leaving out subagents' messages. */
function workerText(e: Event) {
  const message = eventPayload(e, "agent.message");
  if (!message || message.parent_tool_use_id) return undefined;

  return message.text.trim() ? message.text : undefined;
}

const same = (message: string, reply: string) => {
  const a = message.trim();
  const b = reply.trim();

  return a === b || a.endsWith(b);
};

/** Where a sent message waits, if the running turn hasn't taken it yet. */
function queueState(
  id: string,
  pending: Set<string>,
  queued: Set<string>,
): Pick<ConversationMessage, "state"> {
  if (pending.has(id)) return { state: "pending_steer" };
  if (queued.has(id)) return { state: "queued" };

  return {};
}

/**
 * A task's conversation from its events, in order: its request, the
 * messages the user and parent sent, the worker's messages and each
 * successful turn's reply. A reply that repeats the turn's last worker
 * message takes that message's place and id, so it doesn't show twice.
 */
export function conversation(
  task: TaskView,
  events: Event[],
): [ConversationMessage, ...ConversationMessage[]] {
  const pending = new Set(task.pending_steers.map((m) => m.id));
  const queued = new Set(task.queue.map((m) => m.id));
  let turn = 1;

  // The task's request always opens its conversation.
  const messages: [ConversationMessage, ...ConversationMessage[]] = [
    {
      id: "request",
      event_id: 0,
      timestamp: task.created_at,
      turn,
      from: task.created_by,
      kind: "request",
      text: task.description,
    },
  ];

  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const started = eventPayload(e, "task.started");
    if (started) turn = started.turn;

    const instruction = eventPayload(e, "task.instruction");

    if (instruction) {
      const id = instruction.message_id;

      messages.push({
        id,
        event_id: e.id,
        timestamp: e.timestamp,
        turn,
        from: instruction.from,
        kind: "message",
        text: instruction.message,
        delivery: instruction.delivery,
        ...queueState(id, pending, queued),
      });
    }

    if (eventPayload(e, "agent.message")) {
      const text = workerText(e);
      if (text === undefined) continue;
      const id = workerMessageId(e);
      const previous = messages.at(-1);

      // Text blocks of one SDK message form one message.
      if (previous?.id === id && previous.from === "worker") {
        previous.text = `${previous.text}\n\n${text}`;
        previous.event_id = e.id;
        continue;
      }

      messages.push({
        id,
        event_id: e.id,
        timestamp: e.timestamp,
        turn,
        from: "worker",
        kind: "message",
        text,
      });
    }

    const reply = eventPayload(e, "agent.reply");

    if (reply) {
      const text = reply.text;
      const replyTurn = reply.turn;

      const last = messages.findLast(
        (m) => m.from === "worker" && m.turn === replyTurn,
      );

      if (last && last.kind === "message" && same(last.text, text)) {
        last.kind = "reply";
        last.event_id = e.id;
        continue;
      }

      messages.push({
        id: `reply_${e.id}`,
        event_id: e.id,
        timestamp: e.timestamp,
        turn: replyTurn,
        from: "worker",
        kind: "reply",
        text,
      });
    }
  }

  // A reply folded into its SDK message moves it to the reply's event, which
  // can follow a message sent during the turn. Keep cursor order.
  return messages.sort((a, b) => a.event_id - b.event_id);
}
