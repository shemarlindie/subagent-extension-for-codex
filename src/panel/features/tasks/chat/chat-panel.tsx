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
import { NEW_MESSAGES_ID } from "../seen/new-messages";
import { UnseenDot } from "../seen/unseen-dot";
import { useMarkSeen } from "../seen/use-mark-seen";
import { useNewMessagesFrom } from "../seen/use-new-messages-from";
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

  const state = useSnapshot();

  const budgetRaise = budgetDraft.taskId === taskId ? budgetDraft.value : {};

  const changeBudgetRaise = (value: BudgetRaise) =>
    setBudgetDraft({ taskId, value });

  const applyBudgetRaise = async (value: BudgetRaise) => {
    if (!task) return;

    const error = await controller.taskActions.applyBudget(task, value);
    if (!error) setBudgetApplyVersion((version) => version + 1);

    return error;
  };

  const ready = Boolean(task && state.chat?.task === task.id);

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
  } = useReadingScroll({
    reading,
    active: state.tab === "chat",
    ready,
    blockScrollWhileLoading: true,
    reportPositionRestored: true,
    itemAttribute: "data-chat-item",
    focus:
      newFrom === undefined
        ? undefined
        : {
            id: NEW_MESSAGES_ID,
            request: divider.request,
            reveal: divider.reveal,
          },
  });

  useMarkSeen({ task, ready: ready && positionRestored, atLatest: pinned });

  const unseen = Boolean(task?.unseen);

  return (
    <div className="chat">
      <ChatTimeline
        task={task}
        viewportRef={viewportRef}
        positionRestored={positionRestored}
        onLoadingSettled={reconcileAfterContentChange}
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
            unseen ? "Scroll to unseen messages" : "Scroll to latest message"
          }
          className="chat-scroll-latest"
          badge={unseen && <UnseenDot className="scroll-latest-unseen" />}
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
