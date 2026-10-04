import type { ReactNode } from "react";
import type { Task } from "../core/types";
import { locked, pendingQuestions } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
import { Presence } from "./motion";
import { Button } from "./button";
import {
  CollapsibleNotice,
  Notice,
  NoticeText,
  type NoticeTone,
} from "./notice";
import { QuestionForm } from "../forms/question-form";
export function TaskNotices({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    isLocked = locked(task),
    pending = !isLocked ? task.pending_input : undefined,
    error = !isLocked ? task.error : undefined,
    questions =
      pending?.tool === "AskUserQuestion" ? pendingQuestions(task) : undefined;
  // Notices fold in and out so the evidence below slides instead of jumping.
  return (
    <>
      <TaskNotice show={isLocked}>
        <strong>Worker shutdown needs investigation</strong>
        <NoticeText>
          Termination is unconfirmed. Controls are locked. Bring this task to
          Codex to inspect the worker before continuing.
        </NoticeText>
      </TaskNotice>
      <Presence show={Boolean(questions)}>
        {/* Keyed so a new request starts with fresh answers. */}
        <QuestionNotice key={pending?.id} task={task} />
      </Presence>
      <TaskNotice show={Boolean(pending && !questions)}>
        <strong>Permission needed</strong>
        <NoticeText>
          {String(pending?.input.description ?? pending?.tool ?? "")}
        </NoticeText>
        <Button
          id="respond"
          variant="primary"
          disabled={state.busy}
          onClick={() => controller.open({ kind: "respond", task })}
        >
          Review request
        </Button>
      </TaskNotice>
      <TaskNotice show={Boolean(error)} tone="error">
        <NoticeText>{error}</NoticeText>
      </TaskNotice>
    </>
  );
}

// Worker questions expand in place; the whole summary row toggles the stacked cards.
// Keyed by request, so the initial open state is read once per question request.
function QuestionNotice({ task }: { task: Task }) {
  const controller = useController(),
    questions = pendingQuestions(task),
    request = task.pending_input?.id;
  return (
    <CollapsibleNotice
      title={
        questions.length > 1
          ? `Claude has ${questions.length} questions`
          : "Claude has a question"
      }
      // Folds away once the cards show the questions in full.
      summary={
        questions.length > 1 && questions.every((q) => q.header)
          ? questions.map((q) => q.header).join(" · ")
          : questions[0].question
      }
      defaultOpen={!(request && controller.collapsedQuestions.has(request))}
      onOpenChange={(open) => {
        if (!request) return;
        if (open) controller.collapsedQuestions.delete(request);
        else controller.collapsedQuestions.add(request);
      }}
    >
      <QuestionForm task={task} />
    </CollapsibleNotice>
  );
}

// Notices fold in and out so the evidence below slides instead of jumping.
function TaskNotice({
  show,
  tone,
  children,
}: {
  show: boolean;
  tone?: NoticeTone;
  children: ReactNode;
}) {
  return (
    <Presence show={show}>
      <Notice tone={tone}>{children}</Notice>
    </Presence>
  );
}
