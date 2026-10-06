import { memo, useMemo } from "react";

import {
  delimiterOf,
  parseDelimited,
  resultShape,
} from "../../core/artifact-file";
import type { Artifact, ArtifactSummary } from "../../core/types";
import {
  artifactSource,
  type ArtifactView,
  imageSource,
  MAX_PREVIEW_LINES,
} from "../../utils/artifact-view";
import { ResultReport } from "../result-report";
import { CodeView } from "./code-view";
import { DiffView } from "./diff-view";
import { MarkdownView } from "./markdown-view";
import { TableView } from "./table-view";

type ArtifactViewerProps = {
  artifact: Artifact;
  summary: ArtifactSummary;
  view: ArtifactView;
};

// Skip rebuilding a large view tree during urgent tab switches.
export const ArtifactViewer = memo(function ArtifactViewer({
  artifact,
  summary,
  view,
}: ArtifactViewerProps) {
  const report = useMemo(
    () => (view === "report" ? resultShape(artifact.content) : undefined),
    [artifact.content, view],
  );

  // Parses only the rows the table shows; the service counted the rest.
  const rows = useMemo(
    () =>
      view === "table"
        ? parseDelimited(
            artifact.content,
            delimiterOf(artifact),
            MAX_PREVIEW_LINES + 1,
          )
        : [],
    [artifact, view],
  );

  const source = useMemo(
    () => (view === "source" ? artifactSource(artifact) : undefined),
    [artifact, view],
  );

  switch (view) {
    case "report":
      return <ResultReport result={report} />;
    case "preview":
      return <MarkdownView content={artifact.content} />;
    case "diff":
      return <DiffView content={artifact.content} />;
    case "table":
      return (
        <TableView
          rows={rows}
          totalRows={
            summary.snippet.kind === "table"
              ? summary.snippet.total_rows
              : undefined
          }
        />
      );
    case "image":
      return (
        <div className="image-view">
          <img src={imageSource(artifact)} alt={artifact.title} />
        </div>
      );
    case "source":
      return <CodeView {...source!} />;
  }
});
