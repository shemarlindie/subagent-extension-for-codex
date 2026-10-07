import type { Event, Task } from "../../shared/contracts.js";
import { conversation, type ConversationMessage } from "./messages.js";

/** Events Chat is built from, besides compaction markers. */
export const CHAT_EVENTS = [
  "task.started",
  "task.instruction",
  "agent.message",
  "agent.reply",
  "task.turn_ended",
  "task.failed",
  "task.session_started",
  "task.worktree_recreated",
];

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
  note: "session" | "worktree" | "compaction";
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
export const isCompaction = (e: Event) => {
  const raw = e.data.raw_response as Record<string, unknown> | undefined;

  return raw?.type === "system" && raw.subtype === "compact_boundary";
};

function note(e: Event): ChatNote | undefined {
  const base = {
    kind: "note" as const,
    id: `evt_${e.id}`,
    event_id: e.id,
    timestamp: e.timestamp,
  };

  if (e.type === "task.session_started")
    return {
      ...base,
      note: "session",
      text:
        e.data.reason === "no_session"
          ? "New session: the task had none to continue"
          : "New session: the earlier one couldn't continue",
    };

  if (e.type === "task.worktree_recreated")
    return {
      ...base,
      note: "worktree",
      text:
        e.data.from === "base"
          ? "Worktree recreated from the base commit, since its branch was deleted"
          : "Worktree recreated from its branch",
    };

  if (isCompaction(e))
    return { ...base, note: "compaction", text: "Context compacted" };

  return undefined;
}

/**
 * Chat for a task, in order: its conversation (see `conversation`), an
 * outcome row where each turn ended, with a failed turn's error, and small
 * notes for a new session, a recreated worktree and compaction.
 */
export function chatItems(task: Task, events: Event[]): ChatItem[] {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  const messages = conversation(task, sorted);
  const items: ChatItem[] = [];
  let next = 0;

  // Messages are in event order, so they interleave with the rest by event id.
  const flush = (until: number) => {
    while (next < messages.length && messages[next].event_id <= until) {
      const message = messages[next++];

      items.push({
        kind: "message",
        id: message.id,
        event_id: message.event_id,
        message,
      });
    }
  };

  for (const e of sorted) {
    if (e.type === "task.turn_ended") {
      flush(e.id);

      items.push({
        kind: "outcome",
        id: `turn_${String(e.data.turn)}_${e.id}`,
        event_id: e.id,
        timestamp: e.timestamp,
        turn: Number(e.data.turn),
        outcome: e.data.outcome as TurnOutcome["outcome"],
        runtime_ms: Number(e.data.runtime_ms ?? 0),
        cost_usd: Number(e.data.cost_usd ?? 0),
      });
    } else if (e.type === "task.failed") {
      // The failure follows its turn's outcome row.
      const outcome = items.findLast((item) => item.kind === "outcome");

      if (outcome?.kind === "outcome" && outcome.outcome === "failed") {
        outcome.error = String(e.data.error ?? "");
        // A read after the outcome row gets it again, with its error.
        outcome.event_id = e.id;
      }
    } else {
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
