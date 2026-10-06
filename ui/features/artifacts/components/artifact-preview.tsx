import { useEffect, useState } from "react";

import { useController } from "../../../shared/state/controller-context";
import type { Artifact, ArtifactSummary } from "../../../shared/state/types";
import { FilePreview } from "../../file-preview/components/file-preview";
import { Progress } from "../../file-preview/components/progress";
import { DownloadButton } from "./download-button";

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

/** Loads an artifact and previews it as a file named after the artifact. */
export function ArtifactPreview({ summary }: ArtifactPreviewProps) {
  const loaded = useArtifactContent(summary);

  if (loaded.status === "ready")
    return (
      <FilePreview
        file={{
          path: summary.file_name,
          content: loaded.artifact.content,
          mime_type: loaded.artifact.mime_type,
        }}
        actions={
          <DownloadButton
            summary={summary}
            variant="default"
            label="Download"
          />
        }
      />
    );

  return (
    <div className="file-preview">
      {loaded.status === "error" ? (
        <p className="error" role="alert">
          {loaded.message}
        </p>
      ) : (
        <>
          <div className="file-preview-toolbar">
            <span className="file-meta">
              <span className="file-name">{summary.file_name}</span>
            </span>
            <Progress label={`Loading ${summary.file_name}`} />
          </div>
          {/* The progress bar is the accessible status; this line is for sight. */}
          <p className="help" aria-hidden>
            Loading {summary.file_name}…
          </p>
        </>
      )}
    </div>
  );
}
