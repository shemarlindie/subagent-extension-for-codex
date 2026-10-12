import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../shared/components/loading-skeleton/loading-skeleton";
import { DiffSkeletonRows } from "../file-preview/diff/diff-skeleton-rows";

const FILES = ["wide", "medium", "short", "medium"] as const;

/** Shows one expanded file and collapsed headers for the remaining files. */
export function ChangesSkeleton() {
  return (
    <LoadingSkeleton
      label="Reading changes"
      announce={false}
      blockScroll
      className="changes-skeleton"
    >
      {FILES.map((width, index) => (
        <div
          className={`changes-skeleton-file${index === 0 ? " changes-skeleton-file-open" : ""}`}
          key={`${width}-${index}`}
        >
          <div className="changes-skeleton-heading">
            <SkeletonShape className="changes-skeleton-chevron" />
            <SkeletonShape
              className={`changes-skeleton-path changes-skeleton-path-${width}`}
            />
            {index === 1 && <SkeletonShape className="changes-skeleton-tag" />}
            <div className="changes-skeleton-stats">
              <SkeletonShape className="changes-skeleton-stat changes-skeleton-stat-add" />
              <SkeletonShape className="changes-skeleton-stat changes-skeleton-stat-remove" />
            </div>
            <div className="changes-skeleton-actions">
              <SkeletonShape className="changes-skeleton-action" />
              <SkeletonShape className="changes-skeleton-action" />
            </div>
          </div>
          {index === 0 && <DiffSkeletonRows />}
        </div>
      ))}
    </LoadingSkeleton>
  );
}

/** Keeps one stable header placeholder until both task and Changes reads finish. */
export function ChangesHeaderSkeleton() {
  return (
    <LoadingSkeleton label="Loading changes">
      <div className="changes-header changes-header-skeleton">
        <div className="changes-toolbar">
          <div className="changes-skeleton-toolbar-summary">
            <SkeletonShape className="changes-skeleton-summary-line" />
            <SkeletonShape className="changes-skeleton-summary-line changes-skeleton-summary-line-short" />
          </div>
          <SkeletonShape className="changes-skeleton-preview-action" />
          <SkeletonShape className="changes-skeleton-refresh-action" />
        </div>
      </div>
    </LoadingSkeleton>
  );
}
