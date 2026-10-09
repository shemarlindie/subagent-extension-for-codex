import type { Event } from "../../events/types.js";
import type { Delivery, Sender, Task } from "../model.js";

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
};

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** A worker message's SDK id, so its text blocks and draft share it. */
function workerMessageId(e: Event) {
  const raw = object(e.data.raw_response);

  return typeof object(raw.message).id === "string"
    ? String(object(raw.message).id)
    : `evt_${e.id}`;
}

/** Text the main worker wrote, leaving out subagents' messages. */
function workerText(e: Event) {
  const raw = object(e.data.raw_response);
  if (raw.parent_tool_use_id) return undefined;
  if (e.data.role !== undefined && e.data.role !== "assistant")
    return undefined;

  return typeof e.data.text === "string" && e.data.text.trim()
    ? e.data.text
    : undefined;
}

const same = (message: string, reply: string) => {
  const a = message.trim(),
    b = reply.trim();

  return a === b || a.endsWith(b);
};

/**
 * A task's conversation from its events, in order: its request, the
 * messages the user and parent sent, the worker's messages and each
 * successful turn's reply. A reply that repeats the turn's last worker
 * message takes that message's place and id, so it doesn't show twice.
 */
export function conversation(
  task: Task,
  events: Event[],
): ConversationMessage[] {
  const pending = new Set(task.pending_steers.map((m) => m.id));
  const queued = new Set(task.queue.map((m) => m.id));
  let turn = 1;

  const messages: ConversationMessage[] = [
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
    if (e.type === "task.started" && typeof e.data.turn === "number")
      turn = e.data.turn;

    if (e.type === "task.instruction") {
      const id = String(e.data.message_id ?? `evt_${e.id}`);

      messages.push({
        id,
        event_id: e.id,
        timestamp: e.timestamp,
        turn,
        from: e.data.from === "parent" ? "parent" : "user",
        kind: "message",
        text: String(e.data.message ?? ""),
        delivery: e.data.delivery as Delivery | undefined,
        ...(pending.has(id)
          ? { state: "pending_steer" as const }
          : queued.has(id)
            ? { state: "queued" as const }
            : {}),
      });
    }

    if (e.type === "agent.message") {
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

    if (e.type === "agent.reply") {
      const text = String(e.data.text ?? "");
      const replyTurn = typeof e.data.turn === "number" ? e.data.turn : turn;

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

  return messages;
}
