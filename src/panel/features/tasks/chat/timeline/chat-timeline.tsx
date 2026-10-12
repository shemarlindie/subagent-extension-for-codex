import type { RefObject } from "react";

import { providerMetadata } from "../../../../../shared/providers/metadata.js";
import type { ChatItem } from "../../../../../shared/tasks/conversation/chat.js";
import type { BudgetRaise } from "../../../../../shared/tasks/model";
import { useSnapshot } from "../../../../app/state/controller-context";
import { statusLabel } from "../../../../app/state/selectors";
import type { Task } from "../../../../app/state/types";
import { LoadingSwap } from "../../../../shared/components/loading-skeleton/loading-swap";
import { currentActivityStatus } from "../../activity/activity-timeline";
import { rowStatus } from "../../list/task-status";
import { TaskStatusIcon } from "../../list/task-status-icon";
import { composerMode, spentBudget } from "../chat-model";
import { PendingInput } from "../composer/pending-input";
import { BudgetLimitNotice } from "./budget-limit-notice";
import { ChatMessageView } from "./chat-message-view";
import { ChatNoteRow } from "./chat-note-row";
import { ChatSkeleton } from "./chat-skeleton";
import { TurnOutcomeRow } from "./turn-outcome-row";

type ChatTimelineProps = {
  task?: Task;
  viewportRef: RefObject<HTMLDivElement | null>;
  positionRestored: boolean;
  onLoadingSettled: () => void;
  budgetRaise: BudgetRaise;
  onBudgetRaiseChange: (value: BudgetRaise) => void;
  onBudgetApply: (value: BudgetRaise) => Promise<string | undefined>;
};

/**
 * The conversation: messages, turn outcomes and notes, then what the worker
 * is doing now or the input it waits for. It follows new messages while the
 * reader is at the end.
 */
export function ChatTimeline({
  task,
  viewportRef,
  positionRestored,
  onLoadingSettled,
  budgetRaise,
  onBudgetRaiseChange,
  onBudgetApply,
}: ChatTimelineProps) {
  const state = useSnapshot(),
    chat = task && state.chat?.task === task.id ? state.chat : undefined,
    worker = task
      ? (providerMetadata(
          task.provider,
          state.workers.find((w) => w.provider === task.provider)?.metadata,
        )?.displayName ?? task.provider)
      : "";

  // Pending steers and queued messages show above the composer until sent.
  const waiting = new Set(
    task ? [...task.pending_steers, ...task.queue].map((m) => m.id) : [],
  );

  const items = chat?.items.filter(
    (item) => !(item.kind === "message" && waiting.has(item.id)),
  );

  // The message being written, until the stored one with its id arrives.
  const draft = task
    ? state.draft?.task === task.id
      ? state.draft
      : task.draft && { task: task.id, ...task.draft }
    : undefined;

  const streaming =
    draft && !chat?.items.some((item) => item.id === draft.message_id)
      ? draft
      : undefined;

  const activity =
    task?.status === "running" && state.events.length
      ? currentActivityStatus(state.events, task)
      : task?.live_activity;

  const presentation = task
    ? rowStatus({ ...task, live_activity: activity })
    : undefined;

  const working =
    task && composerMode(task) === "busy" && !streaming
      ? task.status === "running" && activity
        ? activity.text
        : statusLabel(task)
      : undefined;

  const latest = items?.at(-1);
  const workingShownInNote = latest?.kind === "note" && latest.text === working;
  const spent = task ? spentBudget(task) : undefined;
  const loading = !task || !items || !positionRestored;

  const loadingSwapClass = items?.length
    ? "chat-loading-swap chat-loading-swap-has-history"
    : "chat-loading-swap";

  return (
    <div
      ref={viewportRef}
      className="chat-timeline"
      tabIndex={0}
      role="region"
      aria-label="Chat history"
      aria-busy={loading || undefined}
    >
      <LoadingSwap
        className={loadingSwapClass}
        loading={loading}
        busy={false}
        skeleton={<ChatSkeleton />}
        onSettled={onLoadingSettled}
      >
        {task && (
          <div className="chat-history">
            {items?.length ? (
              items.map((item, index) =>
                item.kind === "message" ? (
                  <ChatMessageView
                    key={item.id}
                    task={task}
                    message={item.message}
                    worker={worker}
                    outcome={responseOutcome(item, items[index + 1])}
                  />
                ) : item.kind === "outcome" ? (
                  responseOutcome(items[index - 1], item) ? null : (
                    <TurnOutcomeRow key={item.id} outcome={item} />
                  )
                ) : (
                  <ChatNoteRow key={item.id} note={item} />
                ),
              )
            ) : items && !streaming ? (
              <p className="help chat-empty">No messages yet.</p>
            ) : null}
          </div>
        )}
      </LoadingSwap>
      {task && streaming && (
        <ChatMessageView
          message={{
            id: streaming.message_id,
            event_id: Infinity,
            timestamp: "",
            turn: task.turn,
            from: "worker",
            kind: "message",
            text: streaming.text,
          }}
          worker={worker}
          streaming
        />
      )}
      {task && working && !workingShownInNote && presentation && (
        <div className="chat-working" role="status">
          <TaskStatusIcon kind={presentation.kind} label={working} decorative />
          <span>{working}</span>
        </div>
      )}
      {task && spent && (
        <BudgetLimitNotice
          taskId={task.id}
          spent={spent}
          value={budgetRaise}
          onChange={onBudgetRaiseChange}
          onApply={onBudgetApply}
        />
      )}
      {task && <PendingInput task={task} />}
    </div>
  );
}

// Keep an adjacent outcome with the worker response from the same turn.
function responseOutcome(message?: ChatItem, outcome?: ChatItem) {
  return message?.kind === "message" &&
    message.message.from === "worker" &&
    outcome?.kind === "outcome" &&
    message.message.turn === outcome.turn
    ? outcome
    : undefined;
}
