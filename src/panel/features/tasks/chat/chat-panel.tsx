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
import { Composer } from "./composer/composer";
import { MessageQueue } from "./queue/message-queue";
import { ChatTimeline } from "./timeline/chat-timeline";

type ChatPanelProps = { task: Task };

type BudgetRaiseDraft = { taskId: string; value: BudgetRaise };

/** The task as a conversation, with the composer always at the bottom. */
export function ChatPanel({ task }: ChatPanelProps) {
  const controller = useController();

  const [budgetDraft, setBudgetDraft] = useState<BudgetRaiseDraft>(() => ({
    taskId: task.id,
    value: {},
  }));

  const [budgetApplyVersion, setBudgetApplyVersion] = useState(0);

  const state = useSnapshot();

  const budgetRaise = budgetDraft.taskId === task.id ? budgetDraft.value : {};

  const changeBudgetRaise = (value: BudgetRaise) =>
    setBudgetDraft({ taskId: task.id, value });

  const applyBudgetRaise = async (value: BudgetRaise) => {
    const error = await controller.applyBudget(task, value);
    if (!error) setBudgetApplyVersion((version) => version + 1);

    return error;
  };

  const ready = state.chat?.task === task.id;

  const [reading] = useSessionState(
    "task",
    task.id,
    (state) => state.reading.chat,
  );

  const { viewportRef, pinned, scrollToLatest } = useReadingScroll({
    reading,
    active: state.tab === "chat",
    ready,
    itemAttribute: "data-chat-item",
  });

  return (
    <div className="chat">
      <ChatTimeline
        task={task}
        viewportRef={viewportRef}
        budgetRaise={budgetRaise}
        onBudgetRaiseChange={changeBudgetRaise}
        onBudgetApply={applyBudgetRaise}
      />
      <div className="chat-footer">
        {/* Never replace a saved reading position with the empty loading layout. */}
        <ScrollLatestButton
          show={ready && !pinned}
          direction="down"
          label="Scroll to latest message"
          className="chat-scroll-latest"
          onClick={scrollToLatest}
        />
        {/* Keyed so switching tasks swaps the queue instead of animating its rows. */}
        <MessageQueue key={task.id} task={task} />
        {/* Keyed so draft and errors stay with their task. */}
        <Composer
          key={task.id}
          task={task}
          budgetApplyVersion={budgetApplyVersion}
        />
      </div>
    </div>
  );
}
