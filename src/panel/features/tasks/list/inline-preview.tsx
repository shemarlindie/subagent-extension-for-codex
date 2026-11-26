import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { statusFilter } from "../../../app/state/selectors";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../shared/components/loading-skeleton/loading-skeleton";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { MotionContent } from "../../../shared/components/motion/motion-content";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { projectDisplayName } from "../../projects/selectors";
import { WorkerReadinessNotice } from "../../providers/worker-readiness-notice";
import { TaskStatus } from "../shared/status";

export function InlinePreview() {
  const controller = useController();

  const {
    tasks,
    repository,
    selected,
    projects,
    host,
    busy,
    conversation,
    taskListLoading,
    connected,
    connection,
    error,
  } = useSnapshot([
    "tasks",
    "repository",
    "selected",
    "projects",
    "host",
    "busy",
    "conversation",
    "taskListLoading",
    "connected",
    "connection",
    "error",
  ]);

  // Summarize the whole scope, independent of the expanded view's list filters.
  const projectTasks = tasks.filter(
    (task) => !repository || task.repository === repository,
  );

  const attention = projectTasks.filter(
    (task) => statusFilter(task) === "attention",
  );

  const working = projectTasks.filter(
    (task) => statusFilter(task) === "active",
  );

  const unread = projectTasks.filter((task) => task.unread).length;

  const task =
    projectTasks.find((task) => task.id === selected) ??
    attention.at(0) ??
    working.at(0) ??
    projectTasks.at(0);

  const project = projects.find((project) => project.repository === repository);

  const counts = [
    projectTasks.length > 0 &&
      `${projectTasks.length} ${projectTasks.length === 1 ? "task" : "tasks"}`,
    working.length > 0 && `${working.length} working`,
    attention.length > 0 &&
      `${attention.length} ${attention.length === 1 ? "needs" : "need"} attention`,
    unread > 0 && `${unread} unread`,
  ].filter(Boolean);

  const openTask = (id: string) =>
    controller.run(async () => {
      await controller.selection.select(id);
      await controller.transport.expand?.();
    });

  return (
    <section className="inline-preview" aria-label="Delegated Work preview">
      <div className="preview-heading">
        <strong>Delegated Work</strong>
        {host.canExpand && (
          <TooltipWrapper label="Open panel">
            <Button
              id="open-panel"
              variant="ghost"
              className="toolbar-icon-button"
              aria-label="Open panel"
              disabled={busy}
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
        {repository
          ? projectDisplayName(project ?? { repository })
          : "All projects"}
        {" · "}
        {conversation ? "This conversation" : "All conversations"}
      </p>
      <LoadingSwap
        className="inline-preview-loading-swap"
        loading={taskListLoading}
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
        {connected ? (
          <>
            {counts.length > 0 && (
              <p className="preview-counts" role="status">
                {counts.join(" · ")}
              </p>
            )}
            {task ? (
              <MotionContent
                as="div"
                changeKey={task.id}
                className="preview-task"
              >
                <button
                  type="button"
                  className="preview-task-open"
                  onClick={() => openTask(task.id)}
                >
                  <span className="preview-task-title" title={task.title}>
                    {task.title}
                  </span>
                  <small>
                    <TaskStatus task={task} />
                  </small>
                </button>
              </MotionContent>
            ) : (
              <p className="muted">No delegated tasks yet.</p>
            )}
          </>
        ) : (
          <p role="status">{connection}</p>
        )}
      </LoadingSwap>
      <WorkerReadinessNotice />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!host.canExpand && (
        <p className="muted">Expand this app using the chat controls.</p>
      )}
    </section>
  );
}
