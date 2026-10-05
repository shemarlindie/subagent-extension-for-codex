import { useLayoutEffect } from "react";

import { failedStatus, locked, terminal } from "../core/selectors";
import { traceSize } from "../core/size-trace";
import { Button } from "./button";
import { useController, useSnapshot } from "./controller-context";
import { Icon } from "./icons";
import { MotionContent } from "./motion";
import { TaskStatus } from "./status";
import { TooltipWrapper } from "./tooltip";

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

  const attention = tasks.filter((task) => task.pending_input || locked(task));
  const active = tasks.filter((task) => !terminal(task) && !failedStatus(task));

  const task =
    tasks.find((task) => task.id === state.selected) ??
    attention[0] ??
    active[0] ??
    tasks[0];

  const project = state.projects.find(
    (project) => project.repository === state.repository,
  );

  return (
    <section className="inline-preview" aria-label="Delegated work preview">
      <div className="preview-heading">
        <strong>Delegated work</strong>
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
          ? (project?.name ?? state.repository.split("/").at(-1))
          : "All projects"}
        {" · "}
        {state.conversation ? "This conversation" : "All conversations"}
      </p>
      {!state.connected ? (
        <p role="status">{state.connection}</p>
      ) : (
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
      )}
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
