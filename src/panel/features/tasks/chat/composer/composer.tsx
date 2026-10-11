import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type { Delivery } from "../../../../../shared/tasks/model";
import { pendingInputKind } from "../../../../../shared/tasks/model.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { useSessionState } from "../../../../app/state/session/use-session-state";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { Icon } from "../../../../shared/components/icons/icons";
import {
  useAnimatedHeight,
  useListMotion,
} from "../../../../shared/components/motion/motion";
import { MOTION } from "../../../../shared/components/motion/motion-utils";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { FormFieldError } from "../../../../shared/forms/form-field-error";
import { FormFieldHint } from "../../../../shared/forms/form-field-hint";
import { composerMode, spentBudget } from "../chat-model";

const PLACEHOLDERS = {
  idle: "What's next?",
  busy: "Queue",
  input: "Queue",
};

const STEER_KEY = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? "")
  ? "⌘ + Enter"
  : "Ctrl + Enter";

const HINTS = {
  idle: "Enter to send · Shift + Enter for a new line",
  busy: `Enter to queue · ${STEER_KEY} to steer`,
  input: "Answer the question above, or Enter to queue",
};

type ComposerProps = {
  task: Task;
  budgetApplyVersion: number;
};

/**
 * Sends the user's messages: Enter sends, or queues while a turn runs;
 * Cmd/Ctrl+Enter steers a running turn after its next tool call. While the
 * worker waits for input, messages can only be queued. Apply a spent budget increase before sending the next message.
 */
export function Composer({ task, budgetApplyVersion }: ComposerProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    mode = composerMode(task),
    inputHint =
      task.pending_input &&
      pendingInputKind(task.pending_input) === "permission"
        ? "Enter to queue"
        : HINTS.input,
    inputRequest = task.pending_input?.id,
    [expandedRequest, setExpandedRequest] = useState<string>(),
    [manuallyCollapsed, updateComposerSession] = useSessionState(
      "task",
      task.id,
      (state) => state.composerCollapsed,
    ),
    spent = spentBudget(task),
    collapsed = inputRequest
      ? expandedRequest !== inputRequest
      : manuallyCollapsed,
    container = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    showComposer = useRef<HTMLButtonElement>(null),
    focusAfterToggle = useRef<"input" | "toggle" | undefined>(undefined),
    [text, updateSession] = useSessionState(
      "task",
      task.id,
      (state) => state.composerDraft,
    ),
    canContinue = !spent,
    [error, setError] = useState<string>(),
    [showContinuePrompt, setShowContinuePrompt] = useState(false),
    previousBudgetApply = useRef(budgetApplyVersion),
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
    // Reopening applies only to this request, preserving the ordinary preference.
    if (inputRequest) setExpandedRequest(hide ? undefined : inputRequest);
    else updateComposerSession({ composerCollapsed: hide });
  };

  const edit = (value: string) => {
    updateSession({ composerDraft: value });
  };

  useEffect(() => {
    if (previousBudgetApply.current === budgetApplyVersion || !canContinue)
      return;

    previousBudgetApply.current = budgetApplyVersion;
    if (!message) updateSession({ composerDraft: "Continue" });
    setShowContinuePrompt(true);

    if (collapsed) {
      focusAfterToggle.current = "input";
      if (inputRequest) setExpandedRequest(inputRequest);
      else updateComposerSession({ composerCollapsed: false });
    } else input.current?.focus({ preventScroll: true });
  }, [
    budgetApplyVersion,
    canContinue,
    collapsed,
    message,
    inputRequest,
    updateComposerSession,
    updateSession,
  ]);

  const send = async (delivery: Delivery) => {
    if (!message || busy || !canContinue) return;

    setShowContinuePrompt(false);
    const failure = await controller.sendMessage(task, message, delivery);

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
      const steer = event.metaKey || event.ctrlKey;

      // A worker waiting for input can't be steered, so every Enter queues.
      void send(
        mode === "idle" || (mode === "busy" && steer) ? "steer" : "queue",
      );
    }
  };

  const stopButton = (
    <TooltipWrapper label="Stop the turn">
      <Button
        variant="ghost"
        className="chat-icon-button"
        data-action="stop"
        aria-label="Stop the turn"
        disabled={busy}
        onClick={stop}
      >
        <Icon name="stop-solid" size={9} />
      </Button>
    </TooltipWrapper>
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
            <span>
              {spent
                ? "Show composer (limit reached)"
                : message
                  ? "Show composer (draft)"
                  : "Show composer"}
            </span>
          </Button>
          {mode !== "idle" && stopButton}
        </div>
      ) : (
        <div className="chat-composer-body motion-swap">
          <div className="chat-composer-input-row">
            <TooltipWrapper label="Hide composer">
              <Button
                variant="ghost"
                className="chat-icon-button chat-composer-collapse"
                aria-label="Hide composer"
                aria-expanded={true}
                aria-controls="chat-composer-body"
                onClick={() => toggle(true)}
              >
                <Icon name="chevron-down" size={12} />
              </Button>
            </TooltipWrapper>
            <div className="chat-composer-box">
              <textarea
                ref={input}
                id="chat-composer"
                aria-label="Message"
                aria-describedby={
                  [
                    spent ? undefined : "chat-composer-hint",
                    error ? "chat-composer-error" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                rows={1}
                maxLength={20000}
                placeholder={PLACEHOLDERS[mode]}
                value={text}
                onChange={(event) => edit(event.target.value)}
                onKeyDown={keys}
              />
              <div className="chat-composer-actions">
                {/* While a turn runs, an empty composer's button stops it. */}
                {mode === "idle" || (mode === "busy" && message) ? (
                  <TooltipWrapper
                    label={
                      showContinuePrompt
                        ? "Press ENTER to continue"
                        : mode === "busy"
                          ? `Send into the running turn (${STEER_KEY})`
                          : "Send (Enter)"
                    }
                    triggerLabel={
                      showContinuePrompt
                        ? mode === "busy"
                          ? "Steer"
                          : "Send"
                        : undefined
                    }
                    open={showContinuePrompt ? true : undefined}
                    onOpenChange={
                      showContinuePrompt ? setShowContinuePrompt : undefined
                    }
                    popupClassName={
                      showContinuePrompt ? "chat-continue-tooltip" : undefined
                    }
                    arrow={showContinuePrompt}
                    sideOffset={showContinuePrompt ? 14 : undefined}
                  >
                    <Button
                      variant="primary"
                      className="chat-icon-button"
                      data-action="send"
                      aria-label={mode === "busy" ? "Steer" : "Send"}
                      disabled={busy || !message || !canContinue}
                      onClick={() => send("steer")}
                    >
                      <Icon name="enter" size={12} />
                    </Button>
                  </TooltipWrapper>
                ) : (
                  stopButton
                )}
              </div>
            </div>
          </div>
          <FormFieldHint
            id="chat-composer-hint"
            className="chat-composer-field-feedback"
            message={
              spent ? undefined : mode === "input" ? inputHint : HINTS[mode]
            }
          />
        </div>
      )}
      <FormFieldError
        id="chat-composer-error"
        className="chat-error chat-composer-field-feedback"
        message={error}
      />
    </div>
  );
}
