import type { SpentBudget } from "../chat-model";

const QUEUE_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? "⌘ + Enter"
  : "Ctrl + Enter";

export const HINTS = {
  idle: "Enter to send · Shift + Enter for a new line",
  busy: `Enter to steer · ${QUEUE_KEY} to queue`,
  input: "Answer the question above, or Enter to queue",
};

/** The label on the button that reopens a collapsed composer. */
export function expandLabel(
  spent: SpentBudget | undefined,
  hasMessage: boolean,
) {
  if (spent) return "Show composer (limit reached)";

  return hasMessage ? "Show composer (draft)" : "Show composer";
}
