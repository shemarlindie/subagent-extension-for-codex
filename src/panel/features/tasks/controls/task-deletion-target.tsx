import { Collapsible } from "@base-ui/react/collapsible";

import type { TaskDeletionTarget } from "../../../../shared/tasks/deletion-contract.js";
import { Chevron } from "../../../shared/components/chevron";
import { TaskDeletionPath } from "./task-deletion-path";

type TaskDeletionTargetItemProps = {
  task: TaskDeletionTarget;
  defaultOpen: boolean;
};

export function TaskDeletionTargetItem({
  task,
  defaultOpen,
}: TaskDeletionTargetItemProps) {
  const retained = task.retainedWorktree;
  const hasResources = Boolean(task.worktree || task.branch || task.session);
  const hasRetained = retained?.worktree || retained?.branch;

  const label = (
    <span className="task-deletion-label">
      <strong>{task.title}</strong>
      <code>{task.id}</code>
    </span>
  );

  if (!hasResources && !hasRetained) {
    return <li className="task-deletion-plain">{label}</li>;
  }

  return (
    <Collapsible.Root render={<li />} defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="task-deletion-trigger">
        <Chevron size={9} />
        {label}
      </Collapsible.Trigger>
      <Collapsible.Panel className="task-deletion-resources">
        {hasResources && (
          <ul aria-label={`Resources to remove for ${task.title}`}>
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
        )}
        {hasRetained && (
          <>
            <span className="task-deletion-group" aria-hidden>
              Will remain
            </span>
            <ul aria-label="Will remain">
              {retained.worktree && (
                <li>
                  Worktree outside the managed folder:{" "}
                  <code>{retained.worktree}</code>
                </li>
              )}
              {retained.branch && (
                <li>
                  Local Git branch: <code>{retained.branch}</code>
                </li>
              )}
            </ul>
          </>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
