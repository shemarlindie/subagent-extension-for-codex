import type { ArtifactSummary } from "../../core/types";
import { formatBytes } from "../../utils/format";
import { DiffStat } from "./diff-stat";

type ArtifactMetaProps = {
  summary: ArtifactSummary;
};

export function ArtifactMeta({ summary }: ArtifactMetaProps) {
  const snippet = summary.snippet;

  return (
    <span className="file-meta">
      <span className="file-name">{summary.file_name}</span>
      <span>{formatBytes(summary.size)}</span>
      {snippet.kind === "diff" && (
        <span>
          {snippet.total_files} {snippet.total_files === 1 ? "file" : "files"}{" "}
          <DiffStat
            additions={snippet.additions}
            deletions={snippet.deletions}
          />
        </span>
      )}
    </span>
  );
}
