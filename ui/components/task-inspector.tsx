import { useLayoutEffect, useRef, useState } from "react";
import { selectedTask, profileLabel, locked } from "../core/selectors";
import { currentActivityStatus } from "../core/activity-timeline";
import { useController, useSnapshot } from "./controller-context";
import { TaskStatus } from "./status";
import { TaskActions } from "./task-actions";
import { TaskNotices } from "./task-notices";
import { EvidenceTabs } from "./evidence-tabs";
import { WorkerInspector } from "./worker-inspector";
import { TaskDescription } from "./task-description";
import { MotionContent } from "./motion";
import { Button } from "./button";
export function TaskInspector() {
  const controller = useController(),
    state = useSnapshot(),
    task = selectedTask(state);
  const { detailRef, headerRef, stacked } = useStackedLayout(task?.id);
  // Only a running task has live detail beyond its status label.
  // Events load after selection; until then the label alone is accurate.
  const live =
    task?.status === "running" &&
    !task.pending_input &&
    !locked(task) &&
    state.events.length
      ? currentActivityStatus(state.events, task)
      : undefined;
  const displayTask =
    task?.status === "running" && live?.state === "failed"
      ? { ...task, status: "failed" as const }
      : task;
  return (
    <section
      ref={detailRef}
      id="detail"
      className={`detail${task && !state.workerRoute ? " has-task" : ""}`}
      aria-label="Task inspector"
      data-task={task?.id}
      data-stacked={stacked || undefined}
    >
      {state.workerRoute ? (
        <WorkerInspector />
      ) : task ? (
        <div key={task.id} className="task-view">
          <div ref={headerRef} className="task-header">
            <div className="task-topline">
              <Button
                id="back"
                variant="ghost"
                className="back"
                onClick={() => controller.back()}
              >
                ← Tasks
              </Button>
              <div
                className="eyebrow"
                data-live={live && live.state !== "failed" ? "" : undefined}
              >
                <TaskStatus task={displayTask ?? task} activity={live} />
                <span className="eyebrow-worker">
                  / {task.provider} · {profileLabel(task.worker_profile)}
                </span>
                {/* Trails the line so changing detail never shifts the labels before it. */}
                <span className="eyebrow-live" role="status">
                  {live && (
                    <>
                      <span aria-hidden="true">· </span>
                      <MotionContent changeKey={live.text}>
                        {live.text}
                      </MotionContent>
                    </>
                  )}
                </span>
              </div>
            </div>
            <h1 title={task.title}>{task.title}</h1>
            <TaskDescription task={task} />
            <TaskActions task={task} />
            <TaskNotices task={task} />
          </div>
          <EvidenceTabs task={task} />
        </div>
      ) : (
        <div className="empty">
          <span className="eyebrow">A separate workspace. A focused task.</span>
          <h1>
            Keep your flow.
            <br />
            Delegate the next step.
          </h1>
          <p>
            Give a worker a review, investigation, or implementation to work on
            while you stay in Codex.
          </p>
          <Button
            id="empty-start"
            variant="primary"
            disabled={!state.connected || state.busy}
            onClick={() => controller.run(() => controller.delegate())}
          >
            New task
          </Button>
        </div>
      )}
    </section>
  );
}

// Evidence needs room for its tabs and a few activity rows.
const MIN_EVIDENCE_HEIGHT = 280;

// When a fixed header would squeeze the evidence, the whole inspector scrolls instead.
function useStackedLayout(taskId?: string) {
  const detailRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const detail = detailRef.current,
      header = headerRef.current;
    if (!detail || !header || typeof ResizeObserver === "undefined")
      return setStacked(false);
    // Stacking leaves both heights unchanged, so this cannot oscillate.
    const measure = () =>
      setStacked(
        detail.clientHeight - header.offsetHeight < MIN_EVIDENCE_HEIGHT,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(detail);
    observer.observe(header);
    return () => observer.disconnect();
  }, [taskId]);
  return { detailRef, headerRef, stacked };
}
