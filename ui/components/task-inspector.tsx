import { selectedTask, profileLabel } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
import { TaskStatus } from "./status";
import { TaskActions } from "./task-actions";
import { TaskNotices } from "./task-notices";
import { TaskDetails } from "./task-details";
import { EvidenceTabs } from "./evidence-tabs";
import { WorkerInspector } from "./worker-inspector";
export function TaskInspector() {
  const controller = useController(),
    state = useSnapshot(),
    task = selectedTask(state);
  return (
    <section
      id="detail"
      className="detail"
      aria-label="Task inspector"
      data-task={task?.id}
    >
      {state.workerRoute ? (
        <WorkerInspector />
      ) : task ? (
        <div key={task.id}>
          <button
            id="back"
            className="back quiet"
            onClick={() => controller.back()}
          >
            ← Tasks
          </button>
          <div className="eyebrow">
            <TaskStatus task={task} />
            <span>
              {" "}
              / {task.provider} · {profileLabel(task.worker_profile)}
            </span>
          </div>
          <h1>{task.task}</h1>
          <div className="meta">
            <span>
              {task.repository.split("/").at(-1)} · {task.revision} ·{" "}
              {task.workspace_strategy === "current_repo"
                ? "current repository"
                : "isolated worktree"}
            </span>
            <span>{task.budget.max_runtime_minutes} min limit</span>
            <span>
              {task.budget.max_cost_usd === null
                ? "No cost limit"
                : `$${task.budget.max_cost_usd} budget`}
            </span>
          </div>
          <TaskNotices task={task} />
          <TaskActions task={task} />
          <EvidenceTabs task={task} />
          <TaskDetails task={task} />
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
          <button
            id="empty-start"
            className="primary"
            disabled={!state.connected || state.busy}
            onClick={() => controller.run(() => controller.delegate())}
          >
            New task
          </button>
        </div>
      )}
    </section>
  );
}
