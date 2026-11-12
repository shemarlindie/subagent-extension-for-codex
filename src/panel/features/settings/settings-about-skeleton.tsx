import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../shared/components/loading-skeleton/loading-skeleton";

const GROUPS = [
  { title: "Extension", rows: 3 },
  { title: "Claude", rows: 4 },
  { title: "SDKs", rows: 3 },
  { title: "Service runtime", rows: 3 },
];

export function SettingsAboutSkeleton() {
  return (
    <LoadingSkeleton
      label="Loading version details"
      className="settings-about-body"
    >
      {GROUPS.map(({ title, rows }) => (
        <div className="settings-about-group" key={title}>
          <h3>{title}</h3>
          <dl>
            {Array.from({ length: rows }, (_, row) => (
              <div key={row}>
                <dt>
                  <SkeletonShape
                    className="settings-about-skeleton-label"
                    measureText="Version"
                  />
                </dt>
                <dd>
                  <SkeletonShape
                    className="settings-about-skeleton-value"
                    measureText="0.0.000"
                  />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </LoadingSkeleton>
  );
}
