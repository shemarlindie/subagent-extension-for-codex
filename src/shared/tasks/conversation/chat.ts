import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import { failureMessage } from "../failure.js";
import type { Sender, Task } from "../model.js";
import type { PlanStep } from "../plan-contract.js";
import { visualId } from "../visual.js";
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
  "task.plan_ended",
  "agent.visual",
];

/**
 * Whether Chat shows an event: one of `CHAT_EVENTS`, answers to a question,
 * or a context compaction, which Claude reports among its other activity.
 * Stored events keep the answer in their `chat` column, so changing it needs
 * a migration that updates them.
 */
export const isChatEvent = (type: string, data: Record<string, unknown>) =>
  CHAT_EVENTS.includes(type) ||
  (type === "agent.input_decision" && data.answers !== undefined) ||
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

/** Answers to the worker's questions, from whoever answered them. */
export type ChatAnswers = {
  kind: "answers";
  id: string;
  event_id: number;
  timestamp: string;
  from: Sender;
  /** Each question with its answer, in question order. */
  answers: { question: string; answer: string }[];
};

/** A plan that left the pinned card, with its final steps. */
export type ChatPlan = {
  kind: "plan";
  id: string;
  event_id: number;
  timestamp: string;
  steps: PlanStep[];
};

/** A visual the worker showed, at its latest version. */
export type ChatVisual = {
  kind: "visual";
  id: string;
  event_id: number;
  timestamp: string;
  visual: number;
  title: string;
  code: string;
};

export type ChatItem =
  ChatMessage | TurnOutcome | ChatNote | ChatAnswers | ChatPlan | ChatVisual;

/** A context compaction, which Claude reports as a system message. */
const isCompaction = (e: Event) => {
  return e.presentation?.kind === "compact_boundary";
};

const noteFields = (e: Event) => ({
  kind: "note" as const,
  id: `evt_${e.id}`,
  event_id: e.id,
  timestamp: e.timestamp,
});

/** The note for a failure that no turn outcome shows. */
function failureNote(
  e: Event,
  failed: Pick<Task, "error_code" | "error">,
): ChatNote {
  return {
    ...noteFields(e),
    note: "failure",
    text: `Task failed: ${failureMessage(failed) ?? "Unknown error"}`,
  };
}

function note(e: Event): ChatNote | undefined {
  const base = noteFields(e);
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
  if (failed) return failureNote(e, failed);

  if (isCompaction(e)) {
    return {
      ...base,
      note: "compaction",
      text: e.presentation?.statusTitle ?? "Context compacted",
    };
  }

  if (
    e.type === "claude.activity" &&
    e.presentation?.statusTitle === "Context compaction failed"
  ) {
    return { ...base, note: "failure", text: "Context compaction failed" };
  }

  return undefined;
}

function endedPlan(e: Event): ChatPlan | undefined {
  const ended = eventPayload(e, "task.plan_ended");
  if (!ended) return undefined;

  return {
    kind: "plan",
    id: `evt_${e.id}`,
    event_id: e.id,
    timestamp: e.timestamp,
    steps: ended.steps,
  };
}

function shownVisual(e: Event): ChatVisual | undefined {
  const shown = eventPayload(e, "agent.visual");
  if (!shown) return undefined;

  return {
    kind: "visual",
    id: visualId(shown.visual),
    event_id: e.id,
    timestamp: e.timestamp,
    ...shown,
  };
}

/**
 * Puts a visual's new version where the visual is, if it's among `items`. A
 * read that starts after the first version gets it as a new item, which the
 * panel puts in place.
 */
function replacedVisual(items: ChatItem[], marker: ChatItem) {
  if (marker.kind !== "visual") return false;
  const index = items.findIndex((item) => item.id === marker.id);
  if (index < 0) return false;
  items[index] = marker;

  return true;
}

function answered(e: Event): ChatAnswers | undefined {
  const decision = eventPayload(e, "agent.input_decision");
  if (!decision?.answers) return undefined;

  return {
    kind: "answers",
    id: `evt_${e.id}`,
    event_id: e.id,
    timestamp: e.timestamp,
    from: decision.authority,
    answers: Object.entries(decision.answers).map(([question, answer]) => ({
      question,
      answer,
    })),
  };
}

/**
 * Chat for a task, in order: its conversation (see `conversation`), answers
 * to the worker's questions, plans that left the pinned card, visuals at
 * their latest version where they were first shown, an outcome row
 * where each turn ended, with a failed turn's error, standalone task
 * failures, and small notes for a new session, worktree recreation,
 * compaction and a session limited to less than the task asked for. A
 * compaction's note stands in for the output of the command that ran it.
 */
export function chatItems(task: Task, events: Event[]): ChatItem[] {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  const messages = conversation(task, sorted);

  const commandReplies = new Set(
    sorted
      .filter((e) => eventPayload(e, "agent.reply")?.command_output)
      .map((e) => e.id),
  );

  const compactedTurns = new Set<number>();
  let turn = 1;

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
      // Visuals show as their own items, with their code.
      if (
        message.kind === "visual" ||
        (commandReplies.has(message.event_id) &&
          compactedTurns.has(message.turn))
      ) {
        continue;
      }

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
    const failed = eventPayload(e, "task.failed");
    turn = eventPayload(e, "task.started")?.turn ?? turn;

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
    } else if (failed) {
      if (failedOutcome) {
        failedOutcome.error = failureMessage(failed);

        // A read after the outcome row gets it again, with its error.
        failedOutcome.event_id = e.id;
      } else {
        flush(e.id);
        items.push(failureNote(e, failed));
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

      const marker = note(e) ?? answered(e) ?? endedPlan(e) ?? shownVisual(e);

      if (marker && !replacedVisual(items, marker)) {
        flush(e.id);
        items.push(marker);

        if (marker.kind === "note" && marker.note === "compaction") {
          compactedTurns.add(turn);
        }
      }
    }
  }

  flush(Infinity);

  return items;
}
