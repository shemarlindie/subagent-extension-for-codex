import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../shared/components/loading-skeleton/loading-skeleton";

type RowWidth = "wide" | "medium" | "short";

const GROUPS: RowWidth[][] = [
  ["wide", "medium"],
  ["short", "medium"],
];

type TaskListSkeletonProps = {
  /** Mirrors compact rows: one line with a profile and a status mark. */
  compact?: boolean;
};

/**
 * Mirrors project groups, task titles, worker profiles and row metadata.
 * Headers show in every scope: the scope can resolve mid-load, and a fixed
 * shape keeps the placeholder from changing while it's on screen.
 */
export function TaskListSkeleton({ compact = false }: TaskListSkeletonProps) {
  const Row = compact ? CompactSkeletonRow : SkeletonRow;

  return (
    <LoadingSkeleton
      label="Loading tasks"
      blockScroll
      className="task-list-skeleton"
    >
      {GROUPS.map((widths, index) => (
        <div className="task-group" key={index}>
          <div className="task-group-header">
            <SkeletonShape
              className="task-list-skeleton-project"
              measureText="Project name"
            />
          </div>
          {widths.map((width, row) => (
            <Row key={row} width={width} />
          ))}
        </div>
      ))}
    </LoadingSkeleton>
  );
}

type SkeletonRowProps = { width: RowWidth };

const titleClass = (width: RowWidth) =>
  `task-list-skeleton-title task-list-skeleton-title-${width}`;

function SkeletonRow({ width }: SkeletonRowProps) {
  return (
    <div className="task-list-skeleton-row">
      <span className="row-title">
        <SkeletonShape className={titleClass(width)} measureText="Task title" />
      </span>
      <div className="row-meta task-list-skeleton-meta">
        <SkeletonShape className="task-list-skeleton-profile" />
        <div className="task-list-skeleton-trailing">
          <span className="row-runtime">
            <SkeletonShape
              className="task-list-skeleton-runtime"
              measureText="Ran for 5m"
            />
          </span>
          <SkeletonShape className="task-list-skeleton-status" />
        </div>
      </div>
    </div>
  );
}

function CompactSkeletonRow({ width }: SkeletonRowProps) {
  return (
    <div className="task-list-skeleton-row" data-compact="">
      <SkeletonShape className="task-list-skeleton-profile" />
      <span className="row-title">
        <SkeletonShape className={titleClass(width)} measureText="Task title" />
      </span>
      <SkeletonShape className="task-list-skeleton-status" />
    </div>
  );
}
