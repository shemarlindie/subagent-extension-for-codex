import { Fragment, type ReactNode, type RefObject } from "react";

import { providerMetadata } from "../../../../../shared/providers/metadata.js";
import { currentActivityStatus } from "../../../../../shared/tasks/activity/activity-status";
import type { BudgetRaise } from "../../../../../shared/tasks/model";
import { useSnapshot } from "../../../../app/state/controller-context";
import { statusLabel } from "../../../../app/state/selectors";
import type { Task } from "../../../../app/state/types";
import { LoadingSwap } from "../../../../shared/components/loading-skeleton/loading-swap";
import { rowStatus } from "../../list/task-status";
import { TaskStatusIcon } from "../../list/task-status-icon";
import { newMessagesIndex } from "../../unread/new-messages";
import { NewMessagesDivider } from "../../unread/new-messages-divider";
import { useLeavingDivider } from "../../unread/use-leaving-divider";
import type { NewMessages } from "../../unread/use-new-messages-from";
import {
  composerMode,
  draftRow,
  responseOutcome,
  spentBudget,
} from "../chat-model";
import { PendingInput } from "../composer/pending-input";
import { BudgetLimitNotice } from "./budget-limit-notice";
import { ChatMessageView } from "./chat-message-view";
import { ChatNoteRow } from "./chat-note-row";
import { ChatSkeleton } from "./chat-skeleton";
import { TurnOutcomeRow } from "./turn-outcome-row";
import { useHistoryMotion } from "./use-history-motion";

type ChatTimelineProps = {
  task?: Task;
  viewportRef: RefObject<HTMLDivElement | null>;
  positionRestored: boolean;
  onContentChange: () => void;
  budgetRaise: BudgetRaise;
  onBudgetRaiseChange: (value: BudgetRaise) => void;
  onBudgetApply: (value: BudgetRaise) => Promise<string | undefined>;
  /** Where the "New" divider sits; it follows the newest read event. */
  newMessages?: NewMessages;
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
  onContentChange,
  budgetRaise,
  onBudgetRaiseChange,
  onBudgetApply,
  newMessages,
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

  const draftItem = task && draftRow(task, state.draft, chat?.items);
  const visibleItems = items && (draftItem ? [...items, draftItem] : items);

  const activity =
    task?.status === "running" && state.events.length
      ? currentActivityStatus(state.events, task)
      : task?.live_activity;

  const presentation = task
    ? rowStatus({ ...task, live_activity: activity })
    : undefined;

  let working: string | undefined;

  if (task && composerMode(task) === "busy" && !draftItem) {
    working =
      task.status === "running" && activity ? activity.text : statusLabel(task);
  }

  const newFrom = newMessages?.from;

  const newIndex =
    items && newFrom !== undefined
      ? newMessagesIndex(items, newFrom)
      : undefined;

  const newId = newIndex === undefined ? undefined : items?.[newIndex]?.id;
  const { leaving, left } = useLeavingDivider(newId);

  const latest = items?.at(-1);
  const workingShownInNote = latest?.kind === "note" && latest.text === working;
  const workingLabel = workingShownInNote ? undefined : working;
  const spent = task ? spentBudget(task) : undefined;
  const loading = !task || !items || !positionRestored;

  const { historyRef, animateArrivals } = useHistoryMotion(
    task?.id,
    loading,
    onContentChange,
  );

  const loadingSwapClass = visibleItems?.length
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
        onSettled={onContentChange}
      >
        {task && (
          <div className="chat-history" ref={historyRef}>
            {visibleItems?.length
              ? visibleItems.map((item, index) => {
                  let row: ReactNode;

                  if (item.kind === "message") {
                    row = (
                      <ChatMessageView
                        task={task}
                        message={item.message}
                        worker={worker}
                        outcome={responseOutcome(item, visibleItems[index + 1])}
                        streaming={item.id === draftItem?.id}
                        arriving={animateArrivals}
                      />
                    );
                  } else if (item.kind === "outcome") {
                    row = responseOutcome(
                      visibleItems[index - 1],
                      item,
                    ) ? null : (
                      <TurnOutcomeRow outcome={item} />
                    );
                  } else {
                    row = <ChatNoteRow note={item} />;
                  }

                  return (
                    <Fragment key={item.id}>
                      {item.id === newId && (
                        <NewMessagesDivider
                          key="new"
                          animate={newMessages?.reveal}
                        />
                      )}
                      {item.id === leaving && (
                        <NewMessagesDivider
                          key="leaving"
                          leaving
                          onLeft={left}
                        />
                      )}
                      {row}
                    </Fragment>
                  );
                })
              : items && <p className="help chat-empty">No messages yet.</p>}
          </div>
        )}
      </LoadingSwap>
      {!items && draftItem && (
        <ChatMessageView
          key={draftItem.id}
          message={draftItem.message}
          worker={worker}
          streaming
        />
      )}
      {task && (
        <div
          className="chat-working"
          role={workingLabel ? "status" : undefined}
          aria-atomic="true"
        >
          {workingLabel && presentation && (
            <>
              <TaskStatusIcon
                kind={presentation.kind}
                label={workingLabel}
                decorative
              />
              <span title={workingLabel}>{workingLabel}</span>
            </>
          )}
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
