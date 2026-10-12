import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../shared/components/loading-skeleton/loading-skeleton";

type ActivitySkeletonRow = {
  kind: "tool" | "message" | "status";
  title: "wide" | "medium" | "short";
  summary?: "wide" | "short";
  body?: boolean;
  badge?: boolean;
};

const ROWS: ActivitySkeletonRow[] = [
  { kind: "status", title: "short" },
  { kind: "status", title: "medium" },
  { kind: "tool", title: "medium", summary: "wide" },
  { kind: "message", title: "medium", body: true },
  { kind: "tool", title: "wide", summary: "short" },
  { kind: "message", title: "wide", body: true },
] as const;

/** Mirrors grouped activity rows while the selected task's events are read. */
export function ActivitySkeleton({
  announce = true,
}: { announce?: boolean } = {}) {
  return (
    <LoadingSkeleton
      label="Loading activity"
      announce={announce}
      blockScroll
      className="activity-timeline activity-skeleton"
    >
      <div className="activity-viewport activity-skeleton-viewport">
        <div className="timeline">
          {ROWS.map((row, index) => (
            <article
              className={`timeline-item activity-group activity-${row.kind}`}
              data-first={index === 0 || undefined}
              data-last={index === ROWS.length - 1 || undefined}
              key={`${row.kind}-${index}`}
            >
              <div className="activity-group-heading">
                <SkeletonShape className="timeline-dot activity-skeleton-dot" />
                <span className="activity-group-title">
                  <SkeletonShape
                    className={`activity-skeleton-title-line activity-skeleton-title-${row.title}`}
                  />
                  {row.badge && (
                    <SkeletonShape className="activity-skeleton-badge" />
                  )}
                </span>
                <SkeletonShape className="activity-skeleton-time" />
                <span className="activity-debug-toggle activity-skeleton-debug-toggle">
                  <SkeletonShape className="activity-skeleton-debug-icon" />
                </span>
              </div>
              {row.summary && (
                <SkeletonShape
                  className={`activity-group-summary activity-skeleton-summary-${row.summary}`}
                />
              )}
              {row.body && (
                <div className="activity-body activity-skeleton-body">
                  <SkeletonShape className="activity-skeleton-body-line" />
                  <SkeletonShape className="activity-skeleton-body-line activity-skeleton-body-line-medium" />
                  <SkeletonShape className="activity-skeleton-body-line activity-skeleton-body-line-short" />
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </LoadingSkeleton>
  );
}
