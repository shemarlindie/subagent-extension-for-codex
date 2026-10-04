import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Task } from "../core/types";
import { locked } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
export function TaskNotices({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot();
  return (
    <>
      {locked(task) ? (
        <div className="callout attention">
          <strong>Worker shutdown needs investigation</strong>
          <ClampedText>
            Termination is unconfirmed. Controls are locked. Bring this task to
            Codex to inspect the worker before continuing.
          </ClampedText>
        </div>
      ) : (
        task.pending_input && (
          <div className="callout attention">
            <strong>
              {task.pending_input.tool === "AskUserQuestion"
                ? "Claude has a question"
                : "Permission needed"}
            </strong>
            <ClampedText>
              {String(
                task.pending_input.tool === "AskUserQuestion"
                  ? "Review the worker’s question and respond to this request."
                  : (task.pending_input.input.description ??
                      task.pending_input.tool),
              )}
            </ClampedText>
            <button
              id="respond"
              className="primary"
              disabled={state.busy}
              onClick={() => controller.open({ kind: "respond", task })}
            >
              Review request
            </button>
          </div>
        )
      )}
      {task.error && !locked(task) && (
        <div className="callout attention">
          <ClampedText>{task.error}</ClampedText>
        </div>
      )}
    </>
  );
}

// The expanded panel clamps notices so the fixed header leaves room for evidence.
function ClampedText({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
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
        <button
          type="button"
          className="callout-more quiet"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
