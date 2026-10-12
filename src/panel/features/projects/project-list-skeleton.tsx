import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../shared/components/loading-skeleton/loading-skeleton";

const ROWS = ["wide", "medium", "short"] as const;

/** Mirrors saved-project names, approval labels, paths and remove actions. */
export function ProjectListSkeleton() {
  return (
    <LoadingSkeleton
      label="Loading saved projects"
      className="project-list-skeleton"
    >
      <ul className="managed-projects" aria-hidden="true">
        {ROWS.map((width, index) => (
          <li className="managed-project" key={width}>
            <div className="managed-project-summary">
              <div className="managed-project-info">
                <div className="managed-project-heading">
                  <strong className="managed-project-title">
                    <SkeletonShape
                      className={`project-skeleton-name project-skeleton-name-${width}`}
                      measureText="Project name"
                    />
                  </strong>
                  {index === 1 && (
                    <SkeletonShape className="project-skeleton-approval" />
                  )}
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
