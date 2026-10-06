import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useDeferredValue, useEffect, useState } from "react";

import { useController } from "../../../shared/state/controller-context";
import type { Artifact, ArtifactSummary } from "../../../shared/state/types";
import { formatBytes } from "../../../shared/utils/format";
import {
  type ArtifactView,
  artifactViews,
  formatName,
  viewLabel,
} from "../artifact-view";
import { ArtifactProgress } from "./artifact-progress";
import { ArtifactViewer } from "./artifact-viewer";
import { CopyButton } from "./copy-button";
import { DownloadButton } from "./download-button";
import { FileBadge } from "./file-badge";

type ArtifactPreviewProps = {
  summary: ArtifactSummary;
};

type ArtifactLoading = {
  status: "loading";
};

type ArtifactReady = {
  status: "ready";
  artifact: Artifact;
};

type ArtifactLoadError = {
  status: "error";
  message: string;
};

type Loaded = ArtifactLoading | ArtifactReady | ArtifactLoadError;

/** Cards carry only summaries; the content loads when the preview opens. */
function useArtifactContent(summary: ArtifactSummary) {
  const controller = useController();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    let current = true;

    controller.loadArtifact(summary).then(
      (artifact) => current && setLoaded({ status: "ready", artifact }),
      (error: unknown) =>
        current &&
        setLoaded({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );

    return () => {
      current = false;
    };
  }, [controller, summary]);

  return loaded;
}

export function ArtifactPreview({ summary }: ArtifactPreviewProps) {
  const controller = useController(),
    canCopy =
      !controller.transport.embedded &&
      typeof navigator.clipboard?.writeText === "function",
    loaded = useArtifactContent(summary),
    views = artifactViews(summary),
    [view, setView] = useState<ArtifactView>(views[0]),
    // The switcher follows `view` at once; the body renders `shown` in the
    // background, keeping the previous view until the new one is ready.
    shown = useDeferredValue(view),
    rendering = loaded.status === "ready" && shown !== view;

  return (
    // Read-only, so there is no footer: the close button and Escape dismiss it.
    <div className="artifact-preview">
      <div className="artifact-toolbar">
        <FileBadge summary={summary} />
        <span className="file-meta">
          <span className="file-name">{summary.file_name}</span>
          <span>{formatName(summary.format)}</span>
          <span>{formatBytes(summary.size)}</span>
        </span>
        {views.length > 1 && (
          <ToggleGroup
            className="view-switch"
            aria-label="View"
            value={[view]}
            onValueChange={(value) => value[0] && setView(value[0])}
          >
            {views.map((option) => (
              <Toggle key={option} value={option} className="view-option">
                {viewLabel(option)}
              </Toggle>
            ))}
          </ToggleGroup>
        )}
        <span className="toolbar-actions">
          {/* Only show Copy where the browser exposes clipboard access. */}
          {canCopy &&
            summary.format !== "image" &&
            loaded.status === "ready" && (
              <CopyButton text={loaded.artifact.content} />
            )}
          <DownloadButton
            summary={summary}
            variant="default"
            label="Download"
          />
        </span>
        {loaded.status === "loading" && (
          <ArtifactProgress label={`Loading ${summary.file_name}`} />
        )}
        {rendering && <ArtifactProgress label={`Showing ${viewLabel(view)}`} />}
      </div>
      <div className="artifact-body" data-view={shown} aria-busy={rendering}>
        {loaded.status === "ready" ? (
          <ArtifactViewer
            artifact={loaded.artifact}
            summary={summary}
            view={shown}
          />
        ) : loaded.status === "error" ? (
          <p className="error" role="alert">
            {loaded.message}
          </p>
        ) : (
          // The progress bar is the accessible status; this line is for sight.
          <p className="help" aria-hidden>
            Loading {summary.file_name}…
          </p>
        )}
      </div>
    </div>
  );
}
