import { useLayoutEffect, useRef, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { profileLabel, selectedTask } from "../../../app/state/selectors";
import { Icon } from "../../../shared/components/icons/icons";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { MotionContent } from "../../../shared/components/motion/motion";
import { BackButton } from "../../../shared/components/navigation/back-button";
import { Notice } from "../../../shared/components/notice/notice";
import { projectApproved } from "../../projects/selectors";
import { currentActivityStatus } from "../activity/activity-timeline";
import { EvidenceTabs } from "../evidence/evidence-tabs";
import { TaskStatus } from "../shared/status";
import { TaskHeaderSkeleton } from "./task-inspector-skeleton";
import { TaskMenu } from "./task-menu";
import { TaskTitle } from "./task-title";

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

  const loading = !task && Boolean(state.selected) && state.taskListLoading;

  return (
    <section
      ref={detailRef}
      id="detail"
      className={`detail${task || loading ? " has-task" : ""}`}
      aria-label="Task inspector"
      data-task={task?.id}
      data-stacked={stacked || undefined}
      aria-busy={loading || undefined}
    >
      {task || loading ? (
        <div key={state.selected} className="task-view">
          <div ref={headerRef} className="task-header">
            <LoadingSwap
              className="task-header-loading-swap"
              loading={loading}
              busy={false}
              skeleton={<TaskHeaderSkeleton title={task?.title} />}
            >
              {task ? (
                <>
                  <div className="task-topline">
                    <BackButton
                      id="back"
                      className="task-inspector-back"
                      label="Tasks"
                      onClick={() => controller.back()}
                    />
                    <div className="task-meta">
                      <div
                        className="eyebrow"
                        data-live={
                          live && live.state !== "failed" ? "" : undefined
                        }
                      >
                        <span className="eyebrow-status">
                          <TaskStatus
                            task={displayTask ?? task}
                            activity={live}
                          />
                        </span>
                        <span className="eyebrow-worker">
                          {task.provider} · {profileLabel(task.worker_profile)}
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
                    <TaskMenu task={task} />
                  </div>
                  <TaskTitle task={task} />
                  {state.projectsLoaded &&
                    !projectApproved(state.projects, task.repository) && (
                      <Notice>
                        This repository is no longer approved. Add it again
                        before starting another turn. Saved task history remains
                        available.
                      </Notice>
                    )}
                </>
              ) : null}
            </LoadingSwap>
          </div>
          <EvidenceTabs task={task} taskId={state.selected ?? ""} />
        </div>
      ) : (
        <div className="empty">
          <Icon name="task-card" size={33} className="empty-icon" />
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
