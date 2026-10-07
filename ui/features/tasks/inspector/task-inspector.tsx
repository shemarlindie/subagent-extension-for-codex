import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "../../../shared/components/button";
import { Icon } from "../../../shared/components/icons";
import { MotionContent } from "../../../shared/components/motion";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import { profileLabel, selectedTask } from "../../../shared/state/selectors";
import { currentActivityStatus } from "../activity/activity-timeline";
import { EvidenceTabs } from "../evidence/evidence-tabs";
import { TaskStatus } from "../shared/status";
import { HandoffButton } from "./handoff-button";
import { TaskDescription } from "./task-description";
import { TaskMenu } from "./task-menu";

export function TaskInspector() {
  const controller = useController(),
    state = useSnapshot(),
    task = selectedTask(state);

  const { detailRef, headerRef, stacked } = useStackedLayout(task?.id);

  // Only a running task has live detail beyond its status label.
  // Events load after selection; until then the label alone is accurate.
  const live =
    task?.status === "running" && !task.pending_input && state.events.length
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
      className={`detail${task ? " has-task" : ""}`}
      aria-label="Task inspector"
      data-task={task?.id}
      data-stacked={stacked || undefined}
    >
      {task ? (
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
              <div className="task-heading">
                <div
                  className="eyebrow"
                  data-live={live && live.state !== "failed" ? "" : undefined}
                >
                  <span className="eyebrow-status">
                    <TaskStatus task={displayTask ?? task} activity={live} />
                  </span>
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
                <h1 title={task.title}>{task.title}</h1>
              </div>
              <div className="task-tools">
                <HandoffButton task={task} />
                <TaskMenu task={task} />
              </div>
            </div>
            <TaskDescription task={task} />
          </div>
          <EvidenceTabs task={task} />
        </div>
      ) : (
        <div className="empty">
          <Icon name="task-card" size={40} className="empty-icon" />
          <p>Task details will show here.</p>
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
