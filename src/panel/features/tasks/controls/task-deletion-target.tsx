import type { TaskDeletionTarget } from "../../../../shared/tasks/deletion-contract.js";
import { TaskDeletionPath } from "./task-deletion-path";

type TaskDeletionTargetItemProps = {
  task: TaskDeletionTarget;
};

/** One task's resources, split into what deletion removes and what remains. */
export function TaskDeletionTargetItem({ task }: TaskDeletionTargetItemProps) {
  const retained = task.retainedWorktree;

  return (
    <li>
      <strong>{task.title}</strong>
      <code>{task.id}</code>
      <span className="task-deletion-group" aria-hidden>
        Will be removed
      </span>
      <ul aria-label="Will be removed">
        <li>
          Task record, conversation, activity, requests and recorded changes
        </li>
        {task.worktree && (
          <li>
            Worktree folder and all contents, including uncommitted files:{" "}
            <TaskDeletionPath
              path={task.worktree}
              symlinks={task.worktreeSymlinks}
            />
          </li>
        )}
        {task.branch && (
          <li>
            Local Git branch: <code>{task.branch}</code>
          </li>
        )}
        {task.session?.resources.map((resource) => (
          <li key={resource.path}>
            {resource.kind === "directory"
              ? "Session folder and all contents"
              : "Session transcript"}
            :{" "}
            <TaskDeletionPath
              path={resource.path}
              symlinks={resource.symlinks}
            />
          </li>
        ))}
        {task.session && task.session.resources.length === 0 && (
          <li>Provider session, whose files are already gone</li>
        )}
      </ul>
      <span className="task-deletion-group" aria-hidden>
        Will remain
      </span>
      <ul aria-label="Will remain">
        <li>
          Project files:{" "}
          <TaskDeletionPath
            path={task.repository}
            symlinks={task.repositorySymlinks}
          />
        </li>
        {retained?.worktree && (
          <li>
            Worktree outside the managed folder:{" "}
            <code>{retained.worktree}</code>
          </li>
        )}
        {retained?.branch && (
          <li>
            Local Git branch: <code>{retained.branch}</code>
          </li>
        )}
        {!task.session && task.sessionRecorded !== false && (
          <li>Provider session</li>
        )}
      </ul>
      {task.sessionRecorded === false && (
        <span className="form-note">No provider session is recorded.</span>
      )}
    </li>
  );
}
