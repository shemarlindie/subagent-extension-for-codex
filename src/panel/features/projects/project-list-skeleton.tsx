import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../shared/components/loading-skeleton/loading-skeleton";

const ROWS = ["wide", "medium", "short", "wide", "medium"] as const;

/** Mirrors saved-project names, paths and row actions. */
export function ProjectListSkeleton() {
  return (
    <LoadingSkeleton
      label="Loading saved projects"
      className="project-list-skeleton"
    >
      <ul className="managed-projects" aria-hidden="true">
        {ROWS.map((width, index) => (
          <li className="managed-project" key={index}>
            <div className="managed-project-summary">
              <div className="managed-project-info">
                <div className="managed-project-heading">
                  <strong className="managed-project-title">
                    <SkeletonShape
                      className={`project-skeleton-name project-skeleton-name-${width}`}
                    />
                  </strong>
                </div>
                <code className="managed-project-path">
                  <SkeletonShape
                    className="project-skeleton-path"
                    measureText="/Users/name/example-project"
                  />
                </code>
              </div>
              <SkeletonShape className="project-skeleton-remove" />
            </div>
          </li>
        ))}
      </ul>
    </LoadingSkeleton>
  );
}
