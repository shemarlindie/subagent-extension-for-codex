import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
import { LoadingSpinner } from "../../../../shared/components/loading-spinner/loading-spinner";
import { MOTION } from "../../../../shared/components/motion/motion-utils";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { useListMotion } from "../../../../shared/components/motion/use-list-motion";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { FormFieldError } from "../../../../shared/forms/form-field-error";
import { FormFieldHint } from "../../../../shared/forms/form-field-hint";
import { descriptionIds } from "../../../../shared/utils/description-ids";
import { providerName } from "../../../providers/provider-name";
import { composerMode, type SpentBudget, spentBudget } from "../chat-model";
import { TaskRunSettings } from "./task-run-settings";

const QUEUE_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? "⌘ + Enter"
  : "Ctrl + Enter";

const HINTS = {
  idle: "Enter to send · Shift + Enter for a new line",
  busy: `Enter to steer · ${QUEUE_KEY} to queue`,
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
  onSend?: () => void;
  onCollapse?: () => void;
};

/**
 * Sends the user's messages: Enter sends, or steers while a turn runs.
 * Cmd/Ctrl+Enter queues a later turn. While the worker waits for input,
 * messages can only be queued. Apply a spent budget increase before sending
 * the next message.
 */
export function Composer({
  task,
  taskId,
  budgetApplyVersion,
  disabled = false,
  onSend,
  onCollapse,
}: ComposerProps) {
  const controller = useController();
  const { busy, workers } = useSnapshot(["busy", "workers"]);
  const provider = task ? providerName(task.provider, workers) : "agent";
  const sessionTaskId = task?.id ?? taskId ?? "loading";
  const mode = task ? composerMode(task) : "idle";

  const inputHint =
    task?.pending_input && pendingInputKind(task.pending_input) === "permission"
      ? "Enter to queue"
      : HINTS.input;

  const hint = mode === "input" ? inputHint : HINTS[mode];

  const sendTooltip =
    mode === "busy" ? "Send into the running turn (Enter)" : "Send (Enter)";

  const continueLabel = mode === "busy" ? "Steer" : "Send";
  const inputRequest = task?.pending_input?.id;
  const [expandedRequest, setExpandedRequest] = useState<string>();

  const [manuallyCollapsed, updateComposerSession] = useSessionState(
    "task",
    sessionTaskId,
    (state) => state.composerCollapsed,
  );

  const spent = task ? spentBudget(task) : undefined;

  const collapsed = inputRequest
    ? expandedRequest !== inputRequest
    : manuallyCollapsed;

  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const showComposer = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef<"input" | "toggle" | undefined>(undefined);

  const [text, updateSession] = useSessionState(
    "task",
    sessionTaskId,
    (state) => state.composerDraft,
  );

  const canContinue = !spent;

  const [error] = useSessionState(
    "task",
    sessionTaskId,
    (state) => state.composerError,
  );

  const [sending] = useSessionState(
    "task",
    sessionTaskId,
    (state) => state.composerSending,
  );

  const [stopping] = useSessionState(
    "task",
    sessionTaskId,
    (state) => state.composerStopping,
  );

  const sendingFeedback = sending ? "Sending…" : undefined;

  const pendingFeedback = stopping
    ? "Stopping the current turn…"
    : sendingFeedback;

  const [showContinuePrompt, setShowContinuePrompt] = useState(false);
  const previousBudgetApply = useRef(budgetApplyVersion);
  const message = text.trim();
  const feedback = spent ? undefined : hint;

  // Animate one footprint so switching layouts never reserves both heights.
  useAnimatedHeight(container, collapsed);
  // Keep Stop at its previous visual position as it changes layout slots.
  useListMotion(container, "data-action", collapsed, MOTION.base);

  const wasCollapsed = useRef(collapsed);

  useLayoutEffect(() => {
    // Measuring the shorter layout can clamp Chat before the animation starts.
    if (collapsed && !wasCollapsed.current) onCollapse?.();
    wasCollapsed.current = collapsed;
  }, [collapsed, onCollapse]);

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
  // its events load and the composer is enabled, unless the person has moved
  // focus elsewhere since, such as into a menu that focus would close.
  useEffect(() => {
    const { session } = controller;

    if (disabled || collapsed) return;
    if (!session.get("task", sessionTaskId).composerFocus) return;

    session.update("task", sessionTaskId, { composerFocus: undefined });
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
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
    if (
      disabled ||
      !task ||
      !message ||
      controller.session.get("task", sessionTaskId).composerSending ||
      controller.getSnapshot().busy ||
      !canContinue
    ) {
      return;
    }

    // Resume following at the gesture, so a later acknowledgement cannot
    // override a reader who scrolls away while delivery is pending.
    onSend?.();

    updateSession({
      composerSending: true,
      composerStopping: delivery === "interrupt",
      composerError: undefined,
    });

    setShowContinuePrompt(false);

    let failure: string | undefined;

    // The textarea stays editable while sending. Only clear the draft that
    // was acknowledged, including when this composer has since unmounted or
    // the acknowledgement arrives after the send timed out.
    const delivered = () => {
      const session = controller.session.get("task", sessionTaskId);

      updateSession({
        ...(session.composerDraft === text ? { composerDraft: "" } : {}),
        ...(session.composerError === failure
          ? { composerError: undefined }
          : {}),
      });
    };

    try {
      failure = await controller.taskActions.sendMessage(
        task,
        message,
        delivery,
        delivered,
      );

      updateSession({ composerError: failure });
    } finally {
      updateSession({
        composerSending: undefined,
        composerStopping: undefined,
      });
    }
  };

  // Stopping with steers pending sends them at once as the next turn.
  const stop = async () => {
    if (disabled || !task) return;

    updateSession({ composerStopping: true, composerError: undefined });

    try {
      updateSession({
        composerError: await controller.taskActions.interruptTask(
          task,
          task.pending_steers.length > 0,
        ),
      });
    } finally {
      updateSession({ composerStopping: undefined });
    }
  };

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      const queue = event.metaKey || event.ctrlKey;

      // A worker waiting for input can't be steered, so every Enter queues.
      const delivery =
        mode === "idle" || (mode === "busy" && !queue) ? "steer" : "queue";

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
      aria-busy={disabled || sending || undefined}
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
          {pendingFeedback && <span role="status">{pendingFeedback}</span>}
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
                aria-describedby={descriptionIds(
                  spent ? undefined : "chat-composer-hint",
                  error ? "chat-composer-error" : undefined,
                )}
                rows={1}
                maxLength={20000}
                placeholder={`Work with ${provider}`}
                value={text}
                onChange={(event) => edit(event.target.value)}
                onKeyDown={keys}
              />
              <div className="chat-composer-actions">
                {/* While a turn runs, an empty composer's button stops it. */}
                {sending || mode === "idle" || (mode === "busy" && message) ? (
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
                      aria-label={sending ? "Sending…" : continueLabel}
                      disabled={
                        disabled || busy || sending || !message || !canContinue
                      }
                      onClick={() => controller.run(() => send("steer"))}
                    >
                      {sending ? (
                        <LoadingSpinner />
                      ) : (
                        <Icon name="enter" size={12} />
                      )}
                    </Button>
                  </TooltipWrapper>
                ) : (
                  stopButton
                )}
              </div>
            </div>
          </div>
          <div className="chat-composer-meta chat-composer-field-feedback">
            <div role="status">
              <FormFieldHint
                id="chat-composer-hint"
                message={pendingFeedback ?? feedback}
              />
            </div>
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
