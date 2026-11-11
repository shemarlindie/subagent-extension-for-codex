import { useState } from "react";

import type { BudgetRaise } from "../../../../shared/tasks/model";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { Task } from "../../../app/state/types";
import { ScrollLatestButton } from "../../../shared/components/scroll-latest-button/scroll-latest-button";
import { useReadingScroll } from "../evidence/use-reading-scroll";
import { NEW_MESSAGES_ID } from "../unread/new-messages";
import { UnreadDot } from "../unread/unread-dot";
import { useMarkRead } from "../unread/use-mark-read";
import { useNewMessagesFrom } from "../unread/use-new-messages-from";
import { Composer } from "./composer/composer";
import { MessageQueue } from "./queue/message-queue";
import { ChatTimeline } from "./timeline/chat-timeline";

type ChatPanelProps = { task?: Task; taskId: string };

type BudgetRaiseDraft = { taskId: string; value: BudgetRaise };

/** The task as a conversation, with the composer always at the bottom. */
export function ChatPanel({ task, taskId }: ChatPanelProps) {
  const controller = useController();

  const [budgetDraft, setBudgetDraft] = useState<BudgetRaiseDraft>(() => ({
    taskId,
    value: {},
  }));

  const [budgetApplyVersion, setBudgetApplyVersion] = useState(0);

  // Chat content renders in the timeline, so only its task is selected here.
  const { tab, chatTask } = useSnapshot(["tab"], (state) => ({
    chatTask: state.chat?.task,
  }));

  const budgetRaise = budgetDraft.taskId === taskId ? budgetDraft.value : {};

  const changeBudgetRaise = (value: BudgetRaise) =>
    setBudgetDraft({ taskId, value });

  const applyBudgetRaise = async (value: BudgetRaise) => {
    if (!task) return;

    const error = await controller.taskActions.applyBudget(task, value);
    if (!error) setBudgetApplyVersion((version) => version + 1);

    return error;
  };

  const ready = Boolean(task && chatTask === task.id);

  const divider = useNewMessagesFrom(task, ready);
  const newFrom = divider.from;

  const [reading] = useSessionState(
    "task",
    taskId,
    (state) => state.reading.chat,
  );

  const {
    viewportRef,
    pinned,
    positionRestored,
    reconcileAfterContentChange,
    scrollToLatest,
    syncAfterRender,
  } = useReadingScroll({
    reading,
    active: tab === "chat",
    ready,
    blockScrollWhileLoading: true,
    reportPositionRestored: true,
    itemAttribute: "data-chat-item",
    // A streaming reply keeps growing, so rows only fade in as they arrive,
    // while the view glides to follow them.
    animateRows: "arrivals",
    followSmoothly: true,
    syncInChild: true,
    focus:
      newFrom === undefined
        ? undefined
        : {
            id: NEW_MESSAGES_ID,
            request: divider.request,
            reveal: divider.reveal,
          },
  });

  useMarkRead({ task, ready: ready && positionRestored, atLatest: pinned });

  const unread = Boolean(task?.unread);

  return (
    <div className="chat">
      <ChatTimeline
        task={task}
        viewportRef={viewportRef}
        positionRestored={positionRestored}
        onContentChange={reconcileAfterContentChange}
        onRendered={syncAfterRender}
        budgetRaise={budgetRaise}
        onBudgetRaiseChange={changeBudgetRaise}
        onBudgetApply={applyBudgetRaise}
        newMessages={divider}
      />
      <div className="chat-footer">
        {/* Never replace a saved reading position with the empty loading layout. */}
        <ScrollLatestButton
          show={ready && positionRestored && !pinned}
          direction="down"
          label={
            unread ? "Scroll to unread messages" : "Scroll to latest message"
          }
          className="chat-scroll-latest"
          badge={unread && <UnreadDot className="scroll-latest-unread" />}
          onClick={scrollToLatest}
        />
        {/* Keyed so switching tasks swaps the queue instead of animating its rows. */}
        {task && <MessageQueue key={`queue:${task.id}`} task={task} />}
        {/* Keyed so draft and errors stay with their task. */}
        <Composer
          key={`composer:${taskId}`}
          task={task}
          taskId={taskId}
          budgetApplyVersion={budgetApplyVersion}
          disabled={!ready}
        />
      </div>
    </div>
  );
}
