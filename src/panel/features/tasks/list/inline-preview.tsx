import { useLayoutEffect } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { failedStatus, terminal } from "../../../app/state/selectors";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../shared/components/loading-skeleton/loading-skeleton";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { MotionContent } from "../../../shared/components/motion/motion-content";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { traceSize } from "../../../transports/size-trace";
import { projectDisplayName } from "../../projects/selectors";
import { WorkerReadinessNotice } from "../../providers/worker-readiness-notice";
import { TaskStatus } from "../shared/status";

export function InlinePreview() {
  const controller = useController(),
    state = useSnapshot();

  // DEBUG: Measure the first compact commit and the next frame during panel sizing diagnosis.
  useLayoutEffect(() => {
    traceSize("compact-render-committed");
    const frame = requestAnimationFrame(() => traceSize("compact-next-frame"));

    return () => cancelAnimationFrame(frame);
  }, []);

  // Summarize the whole scope, independent of the expanded view's list filters.
  const tasks = state.tasks.filter(
    (task) => !state.repository || task.repository === state.repository,
  );

  const attention = tasks.filter((task) => task.pending_input);
  const active = tasks.filter((task) => !terminal(task) && !failedStatus(task));

  const task =
    tasks.find((task) => task.id === state.selected) ??
    attention.at(0) ??
    active.at(0) ??
    tasks.at(0);

  const project = state.projects.find(
    (project) => project.repository === state.repository,
  );

  return (
    <section className="inline-preview" aria-label="Delegated Work preview">
      <div className="preview-heading">
        <strong>Delegated Work</strong>
        {state.host.canExpand && (
          <TooltipWrapper label="Open panel">
            <Button
              id="open-panel"
              variant="ghost"
              className="toolbar-icon-button"
              aria-label="Open panel"
              disabled={state.busy}
              onClick={() =>
                controller.run(async () => {
                  await controller.transport.expand?.();
                })
              }
            >
              <Icon name="expand" size={14} />
            </Button>
          </TooltipWrapper>
        )}
      </div>
      <p className="preview-scope muted">
        {state.repository
          ? projectDisplayName(project ?? { repository: state.repository })
          : "All projects"}
        {" · "}
        {state.conversation ? "This conversation" : "All conversations"}
      </p>
      <LoadingSwap
        className="inline-preview-loading-swap"
        loading={state.taskListLoading}
        skeleton={
          <LoadingSkeleton label="Loading delegated tasks">
            <div className="preview-counts-skeleton">
              <SkeletonShape className="preview-counts-number" />
              <SkeletonShape className="preview-counts-task" />
              <span className="preview-counts-separator" aria-hidden="true" />
              <SkeletonShape className="preview-counts-number" />
              <SkeletonShape className="preview-counts-active" />
              <span className="preview-counts-separator" aria-hidden="true" />
              <SkeletonShape className="preview-counts-number" />
              <SkeletonShape className="preview-counts-attention" />
            </div>
            <div className="preview-task">
              <SkeletonShape className="preview-title-skeleton" />
              <SkeletonShape className="preview-title-skeleton preview-title-skeleton-short" />
              <div className="preview-status-skeleton">
                <SkeletonShape className="preview-status-dot-skeleton" />
                <SkeletonShape className="preview-status-label-skeleton" />
              </div>
            </div>
          </LoadingSkeleton>
        }
      >
        {state.connected ? (
          <>
            <p className="preview-counts" role="status">
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
              {" · "}
              {active.length} active
              {" · "}
              {attention.length} needing attention
            </p>
            {task ? (
              <MotionContent
                as="div"
                changeKey={task.id}
                className="preview-task"
              >
                <p className="preview-task-title" title={task.title}>
                  {task.title}
                </p>
                <small>
                  <TaskStatus task={task} />
                </small>
              </MotionContent>
            ) : (
              <p className="muted">No delegated tasks yet.</p>
            )}
          </>
        ) : (
          <p role="status">{state.connection}</p>
        )}
      </LoadingSwap>
      <WorkerReadinessNotice />
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {!state.host.canExpand && (
        <p className="muted">Expand this app using the chat controls.</p>
      )}
    </section>
  );
}
