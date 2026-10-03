import { profileLabel, visibleTasks } from "../core/selectors";
import type { Task } from "../core/types";
import { useController, useSnapshot } from "./controller-context";
import { TaskStatus } from "./status";
export function TaskRow({
  task,
  selected,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  onSelect(): void;
}) {
  return (
    <button
      className="row"
      data-task={task.id}
      aria-current={selected}
      onClick={onSelect}
    >
      <span className="row-title">{task.title}</span>
      <span className="row-meta">
        <TaskStatus task={task} /> · {profileLabel(task.worker_profile)}
      </span>
    </button>
  );
}
export function TaskList() {
  const controller = useController(),
    state = useSnapshot(),
    tasks = visibleTasks(state);
  return (
    <>
      <div className="list-label">
        <span id="scope">
          {state.conversation ? "This conversation" : "All conversations"}
        </span>
        <span id="count">
          {state.mode === "console"
            ? `${tasks.length} TASK${tasks.length === 1 ? "" : "S"}`
            : tasks.length}
        </span>
      </div>
      <div id="task-list">
        {!state.connected ? (
          <p className="help">
            {state.connection === "Open through MCP"
              ? "Ask Codex to call open_codex_subagent_extension. Add ?preview=1 for a design preview."
              : "Waiting for the host connection."}
          </p>
        ) : tasks.length ? (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={task.id === state.selected}
              onSelect={() => controller.run(() => controller.select(task.id))}
            />
          ))
        ) : (
          <p className="help">
            No matching tasks. Start a task or change the filter.
          </p>
        )}
      </div>
    </>
  );
}
