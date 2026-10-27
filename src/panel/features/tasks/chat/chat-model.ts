import type {
  ChatItem,
  ChatMessage,
} from "../../../../shared/tasks/conversation/chat.js";
import type { Task } from "../../../app/state/types";
import type { DraftState } from "./drafts/draft-state";

/** Statuses in which a turn is running, starting or about to. */
const BUSY = ["queued", "starting", "running", "waiting"];

/**
 * What the composer can do for a task: start its next turn, steer or
 * queue into a running one, or only queue while the worker waits for input.
 */
export type ComposerMode = "idle" | "busy" | "input";

export function composerMode(task: Task): ComposerMode {
  if (task.pending_input) return "input";

  return BUSY.includes(task.status) ? "busy" : "idle";
}

/** A budget the task has used up, with the amounts used and allowed. */
export type SpentBudget = {
  cost?: { used: number; allowed: number };
  runtime?: { usedMinutes: number; allowedMinutes: number };
};

/**
 * The limits an idle task has reached, so the next message can raise them;
 * undefined while it has room. Claude stops at its own cost estimate, so a
 * budget failure counts even a little under the limit.
 */
export function spentBudget(task: Task): SpentBudget | undefined {
  if (composerMode(task) !== "idle") return undefined;
  const { max_cost_usd, max_runtime_minutes } = task.budget;

  const cost = task.cost_usd ?? 0,
    minutes = task.runtime_ms / 60000,
    failed = task.status === "failed" && /budget/i.test(task.error ?? ""),
    budgetRaise =
      task.budget_raised_for_turn?.turn === task.turn
        ? task.budget_raised_for_turn
        : undefined;

  const spent: SpentBudget = {
    ...(max_cost_usd !== null &&
    (cost >= max_cost_usd ||
      (failed && !budgetRaise?.cost && /cost|usd/i.test(task.error ?? "")))
      ? { cost: { used: cost, allowed: max_cost_usd } }
      : {}),
    ...(max_runtime_minutes !== null &&
    (minutes >= max_runtime_minutes ||
      (failed && !budgetRaise?.runtime && /runtime/i.test(task.error ?? "")))
      ? {
          runtime: {
            usedMinutes: minutes,
            allowedMinutes: max_runtime_minutes,
          },
        }
      : {}),
  };

  return spent.cost || spent.runtime ? spent : undefined;
}

export const formatCost = (usd: number) =>
  `$${usd < 0.01 && usd > 0 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** Keeps an adjacent outcome with the worker response from the same turn. */
export function responseOutcome(message?: ChatItem, outcome?: ChatItem) {
  return message?.kind === "message" &&
    message.message.from === "worker" &&
    outcome?.kind === "outcome" &&
    message.message.turn === outcome.turn
    ? outcome
    : undefined;
}

/**
 * The message being written as a Chat row, until Chat stores the message with
 * its id. The row shares that id, so the stored message replaces it in place.
 */
export function draftRow(
  task: Task,
  draft: DraftState | undefined,
  stored: ChatItem[] = [],
): ChatMessage | undefined {
  const shown = draft?.task === task.id ? draft : task.draft;
  if (!shown || stored.some((item) => item.id === shown.message_id)) return;

  return {
    kind: "message",
    id: shown.message_id,
    event_id: Infinity,
    message: {
      id: shown.message_id,
      event_id: Infinity,
      timestamp: "",
      turn: task.turn,
      from: "worker",
      kind: "message",
      text: shown.text,
    },
  };
}
