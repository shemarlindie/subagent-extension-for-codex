import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { pendingInputKind } from "../../../../src/features/tasks/model.js";
import type { BudgetRaise, Delivery } from "../../../../src/shared/contracts";
import { Button } from "../../../shared/components/button";
import { Icon } from "../../../shared/components/icons";
import {
  useAnimatedHeight,
  useListMotion,
} from "../../../shared/components/motion";
import { MOTION } from "../../../shared/components/motion-utils";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import { pendingQuestions } from "../../../shared/state/selectors";
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
  idle: "What's next?",
  busy: "Steer",
  input: "Queue",
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
    questionRequest =
      task.pending_input &&
      pendingInputKind(task.pending_input) === "question" &&
      pendingQuestions(task).length > 0
        ? task.pending_input.id
        : undefined,
    [expandedRequest, setExpandedRequest] = useState<string>(),
    [manuallyCollapsed, updateComposerSession] = useSessionState(
      "task",
      task.id,
      (state) => state.composerCollapsed,
    ),
    collapsed = questionRequest
      ? expandedRequest !== questionRequest
      : manuallyCollapsed,
    container = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    showComposer = useRef<HTMLButtonElement>(null),
    focusAfterToggle = useRef<"input" | "toggle" | undefined>(undefined),
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

  // Animate one footprint so switching layouts never reserves both heights.
  useAnimatedHeight(container, collapsed);
  // Keep Stop at its previous visual position as it changes layout slots.
  useListMotion(container, "data-action", collapsed, MOTION.base);

  useEffect(() => {
    if (!collapsed && focusAfterToggle.current === "input") {
      focusAfterToggle.current = undefined;
      input.current?.focus({ preventScroll: true });
    } else if (collapsed && focusAfterToggle.current === "toggle") {
      focusAfterToggle.current = undefined;
      showComposer.current?.focus({ preventScroll: true });
    }
  }, [collapsed]);

  const toggle = (hide: boolean) => {
    focusAfterToggle.current = hide ? "toggle" : "input";
    if (questionRequest) setExpandedRequest(hide ? undefined : questionRequest);
    else updateComposerSession({ composerCollapsed: hide });
  };

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

  const stopButton = (
    <Button
      variant="ghost"
      className="chat-icon-button"
      data-action="stop"
      aria-label="Stop the turn"
      title="Stop the turn (Esc)"
      disabled={busy}
      onClick={stop}
    >
      <Icon name="stop-solid" size={14} />
    </Button>
  );

  return (
    <div
      ref={container}
      id="chat-composer-body"
      className="chat-composer"
      data-mode={mode}
    >
      {collapsed ? (
        <div className="chat-composer-toggle-row motion-swap">
          <Button
            ref={showComposer}
            variant="text"
            className="chat-composer-expand"
            aria-expanded={false}
            aria-controls="chat-composer-body"
            onClick={() => toggle(false)}
          >
            <Icon name="chevron-down" size={12} />
            <span>{message ? "Show composer (draft)" : "Show composer"}</span>
          </Button>
          {mode !== "idle" && stopButton}
        </div>
      ) : (
        <div className="chat-composer-body motion-swap">
          {spent && (
            <BudgetRaiseFields
              spent={spent}
              value={budget ?? {}}
              onChange={setRaise}
            />
          )}
          <div className="chat-composer-input-row">
            <Button
              variant="ghost"
              className="chat-icon-button chat-composer-collapse"
              aria-label="Hide composer"
              title="Hide composer"
              aria-expanded={true}
              aria-controls="chat-composer-body"
              onClick={() => toggle(true)}
            >
              <Icon name="chevron-down" size={12} />
            </Button>
            <div className="chat-composer-box">
              <textarea
                ref={input}
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
                    <Icon name="enter" size={16} />
                  </Button>
                ) : (
                  stopButton
                )}
              </div>
            </div>
          </div>
          <p id="chat-composer-hint" className="chat-composer-hint">
            {HINTS[mode]}
          </p>
        </div>
      )}
      {error && (
        <p className="chat-error error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
