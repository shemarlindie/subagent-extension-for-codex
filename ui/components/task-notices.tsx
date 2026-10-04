import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Task } from "../core/types";
import { locked, pendingQuestions } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
import { Collapsible } from "@base-ui/react/collapsible";
import { Presence, useAnimatedHeight } from "./motion";
import { Icon } from "./icons";
import { Button } from "./button";
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
        <ClampedText>
          Termination is unconfirmed. Controls are locked. Bring this task to
          Codex to inspect the worker before continuing.
        </ClampedText>
      </TaskNotice>
      <Presence show={Boolean(questions)}>
        {/* Keyed so a new request starts with fresh answers. */}
        <QuestionNotice key={pending?.id} task={task} />
      </Presence>
      <TaskNotice show={Boolean(pending && !questions)}>
        <strong>Permission needed</strong>
        <ClampedText>
          {String(pending?.input.description ?? pending?.tool ?? "")}
        </ClampedText>
        <Button
          id="respond"
          variant="primary"
          disabled={state.busy}
          onClick={() => controller.open({ kind: "respond", task })}
        >
          Review request
        </Button>
      </TaskNotice>
      <TaskNotice show={Boolean(error)}>
        <ClampedText>{error}</ClampedText>
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
    <Collapsible.Root
      className="callout attention question-notice"
      defaultOpen={!(request && controller.collapsedQuestions.has(request))}
      onOpenChange={(open) => {
        if (!request) return;
        if (open) controller.collapsedQuestions.delete(request);
        else controller.collapsedQuestions.add(request);
      }}
    >
      <Collapsible.Trigger className="question-notice-trigger">
        <span className="question-notice-heading">
          <strong>
            {questions.length > 1
              ? `Claude has ${questions.length} questions`
              : "Claude has a question"}
          </strong>
          {/* Folds away once the cards show the questions in full. */}
          <span className="question-notice-summary">
            <span>
              {questions.length > 1 && questions.every((q) => q.header)
                ? questions.map((q) => q.header).join(" · ")
                : questions[0].question}
            </span>
          </span>
        </span>
        <Icon
          name="chevron-down"
          square
          size={12}
          className="question-notice-caret"
        />
      </Collapsible.Trigger>
      {/* Kept mounted so collapsing keeps the answers chosen so far. */}
      <Collapsible.Panel className="collapse-panel" keepMounted>
        <div className="question-notice-body">
          <QuestionForm task={task} />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

interface TaskNoticeProps {
  show: boolean;
  children: ReactNode;
}

function TaskNotice({ show, children }: TaskNoticeProps) {
  return (
    <Presence show={show}>
      <div className="callout attention">{children}</div>
    </Presence>
  );
}

// The expanded panel clamps notices so the fixed header leaves room for evidence.
function ClampedText({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useAnimatedHeight(ref, open);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, open]);
  return (
    <>
      <p ref={ref} className="callout-text" data-open={open || undefined}>
        {children}
      </p>
      {(overflowing || open) && (
        <Button
          variant="ghost"
          className="callout-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </>
  );
}
