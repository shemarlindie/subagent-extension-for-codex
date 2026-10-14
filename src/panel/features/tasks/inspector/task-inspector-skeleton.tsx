import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../shared/components/loading-skeleton/loading-skeleton";

type TaskHeaderSkeletonProps = { title?: string };

/** Replaces only the task header while its task record is being read. */
export function TaskHeaderSkeleton({ title }: TaskHeaderSkeletonProps) {
  return (
    <LoadingSkeleton
      label="Loading task header"
      announce={false}
      className="task-inspector-skeleton-header"
    >
      <div className="task-topline">
        <div className="task-heading">
          <SkeletonShape className="task-inspector-skeleton-back" />
          <h1 className="task-title task-inspector-skeleton-title">
            <SkeletonShape
              className="task-inspector-skeleton-title-shape"
              measureText={title ?? ""}
            />
          </h1>
        </div>
        <SkeletonShape className="task-inspector-skeleton-menu" />
      </div>
    </LoadingSkeleton>
  );
}
