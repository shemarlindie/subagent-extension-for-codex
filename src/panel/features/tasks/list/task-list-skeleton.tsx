import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../shared/components/loading-skeleton/loading-skeleton";

const ROWS = ["wide", "medium", "short", "medium"] as const;

type TaskListSkeletonProps = {
  showProject: boolean;
};

/** Mirrors task titles, project names, worker profiles and row metadata. */
export function TaskListSkeleton({ showProject }: TaskListSkeletonProps) {
  return (
    <LoadingSkeleton
      label="Loading tasks"
      blockScroll
      className="task-list-skeleton"
    >
      {ROWS.map((width, index) => (
        <div className="task-list-skeleton-row" key={`${width}-${index}`}>
          {showProject && index % 2 === 0 && (
            <span className="row-project">
              <SkeletonShape
                className="task-list-skeleton-project"
                measureText="Project name"
              />
            </span>
          )}
          <span className="row-title">
            <SkeletonShape
              className={`task-list-skeleton-title task-list-skeleton-title-${width}`}
              measureText="Task title"
            />
          </span>
          <div className="row-meta task-list-skeleton-meta">
            <div className="row-worker task-list-skeleton-worker">
              <SkeletonShape className="task-list-skeleton-profile" />
              <span className="row-worker-label">
                <SkeletonShape
                  className="task-list-skeleton-worker-label"
                  measureText="implementer"
                />
              </span>
            </div>
            <div className="task-list-skeleton-trailing">
              <span className="row-runtime">
                <SkeletonShape
                  className="task-list-skeleton-runtime"
                  measureText="Run time 5m"
                />
              </span>
              <SkeletonShape className="task-list-skeleton-status" />
            </div>
          </div>
        </div>
      ))}
    </LoadingSkeleton>
  );
}
