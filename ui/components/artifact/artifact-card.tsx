import type { ArtifactSummary } from "../../core/types";
import { Button } from "../button";
import { useController } from "../controller-context";
import { Icon } from "../icons";
import { TooltipWrapper } from "../tooltip";
import { ArtifactMeta } from "./artifact-meta";
import { ArtifactSnippet } from "./artifact-snippet";
import { DownloadButton } from "./download-button";
import { FileBadge } from "./file-badge";

type ArtifactCardProps = {
  summary: ArtifactSummary;
};

export function ArtifactCard({ summary }: ArtifactCardProps) {
  const controller = useController(),
    preview = () => controller.open({ kind: "artifact", artifact: summary });

  return (
    <article
      className="file-card"
      data-format={summary.format}
      aria-label={summary.title}
    >
      <header className="file-card-head">
        <FileBadge summary={summary} />
        <div className="file-card-title">
          <strong title={summary.title}>{summary.title}</strong>
          <ArtifactMeta summary={summary} />
        </div>
        <TooltipWrapper label="Preview">
          <Button
            variant="ghost"
            className="toolbar-icon-button"
            aria-label={`Preview ${summary.title}`}
            data-artifact={summary.id}
            onClick={preview}
          >
            <Icon name="eye" size={14} />
          </Button>
        </TooltipWrapper>
        <DownloadButton summary={summary} />
      </header>
      {/* The preview button is the accessible route; the snippet is a larger pointer target. */}
      {summary.snippet.kind !== "none" && (
        <div className="file-snippet" aria-hidden onClick={preview}>
          <ArtifactSnippet summary={summary} />
        </div>
      )}
    </article>
  );
}
