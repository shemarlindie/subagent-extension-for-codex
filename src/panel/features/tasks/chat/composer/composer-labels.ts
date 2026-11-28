import { pendingInputKind } from "../../../../../core/shared/tasks/model.js";
import type { Task } from "../../../../app/state/types";
import type { ComposerMode, SpentBudget } from "../chat-model";

const QUEUE_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? "⌘ + Enter"
  : "Ctrl + Enter";

const HINTS = {
  idle: "Enter to send · Shift + Enter for a new line",
  busy: `Enter to steer · ${QUEUE_KEY} to queue`,
  input: "Answer the question above, or Enter to queue",
};

/** The hint under the composer, and the send button's labels, for its mode. */
export function composerLabels(mode: ComposerMode, task?: Task) {
  const permission =
    task?.pending_input &&
    pendingInputKind(task.pending_input) === "permission";

  const inputHint = permission ? "Enter to queue" : HINTS.input;

  return {
    hint: mode === "input" ? inputHint : HINTS[mode],
    sendTooltip:
      mode === "busy" ? "Send into the current turn (Enter)" : "Send (Enter)",
    continueLabel: mode === "busy" ? "Steer" : "Send",
  };
}

/** The label on the button that reopens a collapsed composer. */
export function expandLabel(
  spent: SpentBudget | undefined,
  hasMessage: boolean,
) {
  if (spent) return "Show composer (limit reached)";

  return hasMessage ? "Show composer (draft)" : "Show composer";
}
