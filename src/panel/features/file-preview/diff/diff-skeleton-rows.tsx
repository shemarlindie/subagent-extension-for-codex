import { SkeletonShape } from "../../../shared/components/loading-skeleton/loading-skeleton";

const LINES = [
  { kind: "context", width: "wide" },
  { kind: "del", width: "medium" },
  { kind: "add", width: "wide" },
  { kind: "context", width: "short" },
  { kind: "add", width: "medium" },
] as const;

/** Line-numbered diff rows shared by the Changes and file preview skeletons. */
export function DiffSkeletonRows() {
  return (
    <div className="diff-table diff-skeleton-rows">
      <div className="diff-hunk">
        <SkeletonShape className="diff-skeleton-hunk-line" />
      </div>
      {LINES.map((line, index) => (
        <div
          className={`diff-row ${line.kind} diff-skeleton-row`}
          key={`${line.kind}-${line.width}-${index}`}
        >
          <span className="line-number" aria-hidden="true">
            {line.kind !== "add" && (
              <SkeletonShape className="diff-skeleton-number" />
            )}
          </span>
          <span className="line-number" aria-hidden="true">
            {line.kind !== "del" && (
              <SkeletonShape className="diff-skeleton-number" />
            )}
          </span>
          <span className="diff-sign" aria-hidden="true">
            {line.kind !== "context" && (
              <SkeletonShape className="diff-skeleton-sign" />
            )}
          </span>
          <SkeletonShape
            className={`diff-skeleton-code diff-skeleton-code-${line.width}`}
          />
        </div>
      ))}
    </div>
  );
}
