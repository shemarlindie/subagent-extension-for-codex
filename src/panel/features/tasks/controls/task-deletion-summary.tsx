import type { TaskDeletionPreview } from "../../../../shared/tasks/deletion-contract.js";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { TaskDeletionPath } from "./task-deletion-path";

type TaskDeletionSummaryProps = {
  preview?: TaskDeletionPreview;
  refreshDisabled: boolean;
  onRefresh: () => void;
};

export function TaskDeletionSummary({
  preview,
  refreshDisabled,
  onRefresh,
}: TaskDeletionSummaryProps) {
  const tasks = preview?.tasks ?? [];
  const project = preview?.project;

  const repositories = new Map(
    tasks.map((task) => [task.repository, task.repositorySymlinks]),
  );

  if (project && !repositories.has(project)) {
    repositories.set(project, undefined);
  }

  const retainedSessions = tasks.filter(
    (task) => !task.session && task.sessionRecorded !== false,
  ).length;

  const counts: [number, string][] = [
    [project ? 1 : 0, "project registration"],
    [tasks.length, "task"],
    [tasks.filter((task) => task.worktree).length, "worktree"],
    [tasks.filter((task) => task.branch).length, "branch"],
    [tasks.filter((task) => task.session).length, "provider session"],
  ];

  return (
    <div className="task-deletion-summary">
      {repositories.size > 0 && (
        <div>
          <h3 className="task-deletion-group">Will remain</h3>
          <ul className="task-deletion-retained" aria-label="Will remain">
            {[...repositories].map(([path, symlinks]) => (
              <li key={path}>
                Project files:{" "}
                <TaskDeletionPath path={path} symlinks={symlinks} />
              </li>
            ))}
            {retainedSessions > 0 && (
              <li>
                {retainedSessions === 1
                  ? "Provider session"
                  : `Provider sessions (${retainedSessions})`}
              </li>
            )}
          </ul>
        </div>
      )}
      <div className="task-deletion-removal">
        <div>
          <h3 className="task-deletion-group">Will be removed</h3>
          {preview && (
            <ul className="task-deletion-counts" aria-label="Will be removed">
              {counts
                .filter(([count]) => count > 0)
                .map(([count, label]) => {
                  const plural = label === "branch" ? "branches" : `${label}s`;

                  return (
                    <li key={label}>
                      {count} {count === 1 ? label : plural}
                    </li>
                  );
                })}
            </ul>
          )}
          {tasks.length > 0 && (
            <p className="form-note">
              Includes task history and recorded changes.
            </p>
          )}
        </div>
        <TooltipWrapper label="Refresh removal list">
          <Button
            variant="ghost"
            className="toolbar-icon-button"
            disabled={refreshDisabled}
            onClick={onRefresh}
          >
            <Icon name="refresh" size={14} />
          </Button>
        </TooltipWrapper>
      </div>
    </div>
  );
}
