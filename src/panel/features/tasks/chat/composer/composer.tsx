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
import { MOTION } from "../../../../shared/components/motion/motion-utils";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { useListMotion } from "../../../../shared/components/motion/use-list-motion";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { FormFieldError } from "../../../../shared/forms/form-field-error";
import { FormFieldHint } from "../../../../shared/forms/form-field-hint";
import { composerMode, type SpentBudget, spentBudget } from "../chat-model";
import { TaskRunSettings } from "./task-run-settings";

const PLACEHOLDERS = {
  idle: "What's next?",
  busy: "Queue",
  input: "Queue",
};

const STEER_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? "⌘ + Enter"
  : "Ctrl + Enter";

const HINTS = {
  idle: "Enter to send · Shift + Enter for a new line",
  busy: `Enter to queue · ${STEER_KEY} to steer`,
  input: "Answer the question above, or Enter to queue",
};

/** The label on the button that reopens a collapsed composer. */
function expandLabel(spent: SpentBudget | undefined, draft: string) {
  if (spent) return "Show composer (limit reached)";

  return draft ? "Show composer (draft)" : "Show composer";
}

type ComposerProps = {
  task?: Task;
  taskId?: string;
  budgetApplyVersion: number;
  disabled?: boolean;
};

/**
 * Sends the user's messages: Enter sends, or queues while a turn runs;
 * Cmd/Ctrl+Enter steers a running turn after its next tool call. While the
 * worker waits for input, messages can only be queued. Apply a spent budget increase before sending the next message.
 */
export function Composer({
  task,
  taskId,
  budgetApplyVersion,
  disabled = false,
}: ComposerProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    sessionTaskId = task?.id ?? taskId ?? "loading",
    mode = task ? composerMode(task) : "idle",
    inputHint =
      task?.pending_input &&
      pendingInputKind(task.pending_input) === "permission"
        ? "Enter to queue"
        : HINTS.input,
    hint = mode === "input" ? inputHint : HINTS[mode],
    sendTooltip =
      mode === "busy"
        ? `Send into the running turn (${STEER_KEY})`
        : "Send (Enter)",
    continueLabel = mode === "busy" ? "Steer" : "Send",
    inputRequest = task?.pending_input?.id,
    [expandedRequest, setExpandedRequest] = useState<string>(),
    [manuallyCollapsed, updateComposerSession] = useSessionState(
      "task",
      sessionTaskId,
      (state) => state.composerCollapsed,
    ),
    spent = task ? spentBudget(task) : undefined,
    collapsed = inputRequest
      ? expandedRequest !== inputRequest
      : manuallyCollapsed,
    container = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    showComposer = useRef<HTMLButtonElement>(null),
    focusAfterToggle = useRef<"input" | "toggle" | undefined>(undefined),
    [text, updateSession] = useSessionState(
      "task",
      sessionTaskId,
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

  // A task started from the new-task composer keeps typing focus here once
  // its events load and the composer is enabled.
  useEffect(() => {
    const { session } = controller;

    if (disabled || collapsed) return;
    if (!session.get("task", sessionTaskId).composerFocus) return;

    session.update("task", sessionTaskId, { composerFocus: undefined });
    input.current?.focus({ preventScroll: true });
  }, [controller, collapsed, disabled, sessionTaskId]);

  const toggle = (hide: boolean) => {
    if (disabled) return;

    focusAfterToggle.current = hide ? "toggle" : "input";
    // Reopening applies only to this request, preserving the ordinary preference.
    if (inputRequest) setExpandedRequest(hide ? undefined : inputRequest);
    else updateComposerSession({ composerCollapsed: hide });
  };

  const edit = (value: string) => {
    updateSession({ composerDraft: value });
  };

  useEffect(() => {
    if (disabled) {
      previousBudgetApply.current = budgetApplyVersion;

      return;
    }

    if (previousBudgetApply.current === budgetApplyVersion || !canContinue) {
      return;
    }

    previousBudgetApply.current = budgetApplyVersion;
    if (!message) updateSession({ composerDraft: "Continue" });
    setShowContinuePrompt(true);

    if (collapsed) {
      focusAfterToggle.current = "input";
      if (inputRequest) setExpandedRequest(inputRequest);
      else updateComposerSession({ composerCollapsed: false });
    } else {
      input.current?.focus({ preventScroll: true });
    }
  }, [
    budgetApplyVersion,
    canContinue,
    collapsed,
    disabled,
    message,
    inputRequest,
    updateComposerSession,
    updateSession,
  ]);

  const send = async (delivery: Delivery) => {
    if (disabled || !task || !message || busy || !canContinue) return;

    setShowContinuePrompt(false);

    const failure = await controller.taskActions.sendMessage(
      task,
      message,
      delivery,
    );

    setError(failure);
    if (!failure) edit("");
  };

  // Stopping with steers pending sends them at once as the next turn.
  const stop = async () => {
    if (disabled || !task) return;

    setError(
      await controller.taskActions.interruptTask(
        task,
        task.pending_steers.length > 0,
      ),
    );
  };

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      const steer = event.metaKey || event.ctrlKey,
        // A worker waiting for input can't be steered, so every Enter queues.
        delivery =
          mode === "idle" || (mode === "busy" && steer) ? "steer" : "queue";

      controller.run(() => send(delivery));
    }
  };

  const stopButton = (
    <TooltipWrapper label="Stop the turn">
      <Button
        variant="ghost"
        className="chat-icon-button"
        data-action="stop"
        aria-label="Stop the turn"
        disabled={disabled || busy}
        onClick={() => controller.run(stop)}
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
      data-loading={disabled || undefined}
      aria-busy={disabled || undefined}
    >
      {collapsed ? (
        <div className="chat-composer-toggle-row motion-swap">
          <Button
            ref={showComposer}
            variant="text"
            className="chat-composer-expand"
            aria-expanded={false}
            aria-controls="chat-composer-body"
            disabled={disabled}
            onClick={() => toggle(false)}
          >
            <Icon name="chevron-down" size={12} />
            <span>{expandLabel(spent, message)}</span>
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
                disabled={disabled}
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
                disabled={disabled}
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
                        : sendTooltip
                    }
                    triggerLabel={
                      showContinuePrompt ? continueLabel : undefined
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
                      disabled={disabled || busy || !message || !canContinue}
                      onClick={() => controller.run(() => send("steer"))}
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
          <div className="chat-composer-meta chat-composer-field-feedback">
            <FormFieldHint
              id="chat-composer-hint"
              message={spent ? undefined : hint}
            />
            {task && <TaskRunSettings task={task} />}
          </div>
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
