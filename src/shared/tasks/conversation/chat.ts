import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import { failureMessage } from "../failure.js";
import type { Task } from "../model.js";
import { conversation, type ConversationMessage } from "./messages.js";

/**
 * Events Chat is built from, besides compaction markers. Input requests add
 * no item, since Chat shows the pending request from the task, but reading
 * them moves Chat's cursor past every `READ_EVENTS` event it has shown.
 */
export const CHAT_EVENTS = [
  "task.started",
  "task.instruction",
  "agent.message",
  "agent.reply",
  "task.turn_ended",
  "task.failed",
  "task.session_started",
  "task.worktree_recreated",
  "agent.limited",
  "agent.input_required",
];

/**
 * Whether Chat shows an event: one of `CHAT_EVENTS`, or a context compaction,
 * which Claude reports among its other activity. Stored events keep the answer
 * in their `chat` column, so changing it needs a migration that updates them.
 */
export const isChatEvent = (type: string, data: Record<string, unknown>) =>
  CHAT_EVENTS.includes(type) ||
  (type === "claude.activity" &&
    (data.subtype === "compact_boundary" || data.compact_result === "failed"));

/** How a turn ended, for its outcome row. */
export type TurnOutcome = {
  kind: "outcome";
  id: string;
  event_id: number;
  timestamp: string;
  turn: number;
  outcome: "completed" | "failed" | "interrupted";
  runtime_ms: number;
  cost_usd: number;
  error?: string;
};

/** A small marker between messages. */
export type ChatNote = {
  kind: "note";
  id: string;
  event_id: number;
  timestamp: string;
  note: "session" | "worktree" | "compaction" | "failure" | "limited";
  text: string;
};

/** A message in Chat, with the id and event it keeps from the conversation. */
export type ChatMessage = {
  kind: "message";
  id: string;
  event_id: number;
  message: ConversationMessage;
};

export type ChatItem = ChatMessage | TurnOutcome | ChatNote;

/** A context compaction, which Claude reports as a system message. */
const isCompaction = (e: Event) => {
  return e.presentation?.kind === "compact_boundary";
};

function note(e: Event): ChatNote | undefined {
  const base = {
    kind: "note" as const,
    id: `evt_${e.id}`,
    event_id: e.id,
    timestamp: e.timestamp,
  };

  const session = eventPayload(e, "task.session_started");

  if (session) {
    return {
      ...base,
      note: "session",
      text:
        session.reason === "no_session"
          ? "New session: the task had none to continue"
          : "New session: the earlier one couldn't continue",
    };
  }

  const worktree = eventPayload(e, "task.worktree_recreated");

  if (worktree) {
    return {
      ...base,
      note: "worktree",
      text:
        worktree.from === "base"
          ? "Worktree recreated from the base commit, since its branch was deleted"
          : "Worktree recreated from its branch",
    };
  }

  const limited = eventPayload(e, "agent.limited");
  if (limited) return { ...base, note: "limited", text: limited.reason };

  const failed = eventPayload(e, "task.failed");

  if (failed) {
    return {
      ...base,
      note: "failure",
      text: `Task failed: ${failureMessage(failed) ?? "Unknown error"}`,
    };
  }

  if (isCompaction(e)) {
    return { ...base, note: "compaction", text: "Context compacted" };
  }

  if (
    e.type === "claude.activity" &&
    e.presentation?.statusTitle === "Context compaction failed"
  ) {
    return { ...base, note: "failure", text: "Context compaction failed" };
  }

  return undefined;
}

/**
 * Chat for a task, in order: its conversation (see `conversation`), an
 * outcome row where each turn ended, with a failed turn's error, standalone
 * task failures, and small notes for a new session, worktree recreation,
 * compaction and a session limited to less than the task asked for.
 */
export function chatItems(task: Task, events: Event[]): ChatItem[] {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  const messages = conversation(task, sorted);

  const items: ChatItem[] = [];
  let next = 0;
  let failedOutcome: TurnOutcome | undefined;

  // Messages are in event order, so they interleave with the rest by event id.
  const flush = (until: number) => {
    for (
      let message = messages[next];
      message && message.event_id <= until;
      message = messages[++next]
    ) {
      items.push({
        kind: "message",
        id: message.id,
        event_id: message.event_id,
        message,
      });
    }
  };

  for (const e of sorted) {
    const turnEnded = eventPayload(e, "task.turn_ended");

    if (turnEnded) {
      flush(e.id);

      const outcome: TurnOutcome = {
        kind: "outcome",
        id: `turn_${turnEnded.turn}_${e.id}`,
        event_id: e.id,
        timestamp: e.timestamp,
        turn: turnEnded.turn,
        outcome: turnEnded.outcome,
        runtime_ms: turnEnded.runtime_ms,
        cost_usd: turnEnded.cost_usd,
      };

      items.push(outcome);
      failedOutcome = outcome.outcome === "failed" ? outcome : undefined;
    } else if (eventPayload(e, "task.failed")) {
      if (failedOutcome) {
        failedOutcome.error = failureMessage(eventPayload(e, "task.failed")!);

        // A read after the outcome row gets it again, with its error.
        failedOutcome.event_id = e.id;
      } else {
        flush(e.id);
        items.push(note(e)!);
      }

      failedOutcome = undefined;
    } else {
      if (
        eventPayload(e, "task.instruction") !== undefined ||
        eventPayload(e, "task.queued") !== undefined ||
        eventPayload(e, "task.started") !== undefined
      ) {
        failedOutcome = undefined;
      }

      const marker = note(e);

      if (marker) {
        flush(e.id);
        items.push(marker);
      }
    }
  }

  flush(Infinity);

  return items;
}
