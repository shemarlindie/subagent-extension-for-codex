import { useLayoutEffect, useRef, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { selectedTask } from "../../../app/state/selectors";
import { Icon } from "../../../shared/components/icons/icons";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { BackButton } from "../../../shared/components/navigation/back-button";
import { Notice } from "../../../shared/components/notice/notice";
import { NewTaskView } from "../../delegation/new-task/new-task-view";
import { projectApproved } from "../../projects/selectors";
import { EvidenceTabs } from "../evidence/evidence-tabs";
import { TaskInspectorLoading } from "./task-inspector-loading";
import { TaskHeaderSkeleton } from "./task-inspector-skeleton";
import { TaskMenu } from "./task-menu";
import { TaskTitle } from "./task-title";
import { useArrivalMotion } from "./use-arrival-motion";

export function TaskInspector() {
  const controller = useController(),
    state = useSnapshot(),
    task = selectedTask(state);

  const { detailRef, headerRef, stacked } = useStackedLayout(task?.id);

  useArrivalMotion(detailRef, task?.id);

  const loading = !task && Boolean(state.selected) && state.taskListLoading;
  // Hosts without a restored selection pick a task once the list loads.
  const awaitingSelection = !task && !loading && state.taskListLoading;

  if (state.newTask) {
    return (
      <section id="detail" className="detail has-task" aria-label="New task">
        <NewTaskView newTask={state.newTask} />
      </section>
    );
  }

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
                    <div className="task-heading">
                      <BackButton
                        id="back"
                        className="task-inspector-back"
                        label="Tasks"
                        onClick={() => controller.back()}
                      />
                      <TaskTitle task={task} />
                    </div>
                    <TaskMenu task={task} />
                  </div>
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
        !awaitingSelection && (
          <div className="empty">
            <Icon name="task-card" size={33} className="empty-icon" />
            <p>Task details will show here.</p>
          </div>
        )
      )}
      <TaskInspectorLoading loading={awaitingSelection} />
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

    if (!detail || !header || typeof ResizeObserver === "undefined") {
      return setStacked(false);
    }

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
