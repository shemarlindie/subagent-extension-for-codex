import type { ArtifactSummary } from "../../../shared/state/types";
import { formatBytes } from "../../../shared/utils/format";
import { DiffStat } from "../../file-preview/components/diff-stat";

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
