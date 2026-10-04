import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Task } from "../core/types";
import { locked } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
import { Presence, useAnimatedHeight } from "./motion";
import { Button } from "./button";
export function TaskNotices({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    isLocked = locked(task),
    pending = !isLocked ? task.pending_input : undefined,
    error = !isLocked ? task.error : undefined;
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
      <TaskNotice show={Boolean(pending)}>
        <strong>
          {pending?.tool === "AskUserQuestion"
            ? "Claude has a question"
            : "Permission needed"}
        </strong>
        <ClampedText>
          {String(
            pending?.tool === "AskUserQuestion"
              ? "Review the worker’s question and respond to this request."
              : (pending?.input.description ?? pending?.tool ?? ""),
          )}
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
