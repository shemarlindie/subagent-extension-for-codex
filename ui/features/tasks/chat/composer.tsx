import { type KeyboardEvent, useState } from "react";

import type { BudgetRaise, Delivery } from "../../../../src/shared/contracts";
import { Button } from "../../../shared/components/button";
import { Icon } from "../../../shared/components/icons";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import type { Task } from "../../../shared/state/types";
import { useSessionState } from "../../../shared/state/use-session-state";
import { BudgetRaiseFields } from "./budget-raise-fields";
import {
  budgetRaised,
  composerMode,
  spentBudget,
  suggestedRaise,
} from "./chat-model";

const PLACEHOLDERS = {
  idle: "Message the worker to start its next turn",
  busy: "Steer the running turn",
  input: "Queue a message for after the worker's question",
};

const HINTS = {
  idle: "Enter to send · Shift+Enter for a new line",
  busy: "Enter to steer · Tab to queue · Esc to stop",
  input: "Answer the question above, or Enter to queue · Esc to stop",
};

type ComposerProps = { task: Task };

/**
 * Sends the user's messages with the Codex keys: Enter sends, or steers a
 * running turn after its next tool call; Tab queues while a turn runs; Esc
 * stops the turn. While the worker waits for input, messages can only be
 * queued. A spent budget can be raised with the next message.
 */
export function Composer({ task }: ComposerProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    mode = composerMode(task),
    spent = spentBudget(task),
    [text, updateSession] = useSessionState(
      "task",
      task.id,
      (state) => state.composerDraft,
    ),
    // The user's changes to the suggested raise.
    [raise, setRaise] = useState<BudgetRaise>({}),
    budget = spent ? { ...suggestedRaise(spent), ...raise } : undefined,
    canContinue = !spent || budgetRaised(spent, budget ?? {}),
    [error, setError] = useState<string>(),
    message = text.trim();

  const edit = (value: string) => {
    updateSession({ composerDraft: value });
  };

  const send = async (delivery: Delivery) => {
    if (!message || busy || !canContinue) return;

    const failure = await controller.sendMessage(
      task,
      message,
      delivery,
      budget,
    );

    setError(failure);
    if (!failure) edit("");
  };

  // Stopping with steers pending sends them at once as the next turn.
  const stop = async () =>
    setError(
      await controller.interruptTask(task, task.pending_steers.length > 0),
    );

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(mode === "input" ? "queue" : "steer");
    } else if (
      event.key === "Tab" &&
      !event.shiftKey &&
      mode !== "idle" &&
      message
    ) {
      // Otherwise Tab moves focus as usual.
      event.preventDefault();
      void send("queue");
    } else if (event.key === "Escape" && mode !== "idle") {
      event.preventDefault();
      event.stopPropagation();
      void stop();
    }
  };

  return (
    <div className="chat-composer" data-mode={mode}>
      {spent && (
        <BudgetRaiseFields
          spent={spent}
          value={budget ?? {}}
          onChange={setRaise}
        />
      )}
      <div className="chat-composer-box">
        <textarea
          id="chat-composer"
          aria-label="Message"
          aria-describedby="chat-composer-hint"
          rows={1}
          maxLength={20000}
          placeholder={PLACEHOLDERS[mode]}
          value={text}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={keys}
        />
        <div className="chat-composer-actions">
          {mode !== "idle" && message && (
            <Button
              data-action="queue"
              disabled={busy}
              onClick={() => send("queue")}
            >
              Queue
            </Button>
          )}
          {/* While a turn runs, an empty composer's button stops it. */}
          {mode === "idle" || (mode === "busy" && message) ? (
            <Button
              variant="primary"
              className="chat-icon-button"
              data-action="send"
              aria-label={mode === "busy" ? "Steer" : "Send"}
              title={
                mode === "busy"
                  ? "Send into the running turn (Enter)"
                  : "Send (Enter)"
              }
              disabled={busy || !message || !canContinue}
              onClick={() => send("steer")}
            >
              <Icon name="arrow-up" size={14} />
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="chat-icon-button"
              data-action="stop"
              aria-label="Stop the turn"
              title="Stop the turn (Esc)"
              disabled={busy}
              onClick={stop}
            >
              <Icon name="stop" size={14} />
            </Button>
          )}
        </div>
      </div>
      <p id="chat-composer-hint" className="chat-composer-hint">
        {HINTS[mode]}
      </p>
      {error && (
        <p className="chat-error error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
