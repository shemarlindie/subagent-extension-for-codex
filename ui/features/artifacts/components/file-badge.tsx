import type { ArtifactSummary } from "../../../shared/state/types";
import { fileBadge } from "../artifact-view";

type FileBadgeProps = {
  summary: ArtifactSummary;
};

export function FileBadge({ summary }: FileBadgeProps) {
  return (
    <span className="file-badge" data-format={summary.format} aria-hidden>
      {fileBadge(summary.file_name)}
    </span>
  );
}
