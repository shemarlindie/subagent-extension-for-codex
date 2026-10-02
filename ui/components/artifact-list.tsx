import type { Artifact } from "../core/types";
import { useController, useSnapshot } from "./controller-context";
export function downloadArtifact(artifact: Artifact) {
  const url = URL.createObjectURL(
    new Blob([artifact.content], { type: artifact.mime_type }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.id + (artifact.type === "diff" ? ".patch" : ".json");
  link.click();
  URL.revokeObjectURL(url);
}
export function ArtifactContent({ artifact }: { artifact: Artifact }) {
  return (
    <pre data-scroll={`artifact-${artifact.id}`}>
      {artifact.type === "diff"
        ? artifact.content.split("\n").map((line, index) => (
            <span
              key={index}
              className={`diff-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : ""}`}
            >
              {line}
            </span>
          ))
        : artifact.content}
    </pre>
  );
}
export function ArtifactList() {
  const controller = useController(),
    state = useSnapshot();
  const artifacts = state.selectedArtifact
    ? state.artifacts.filter(
        (artifact) => artifact.id === state.selectedArtifact,
      )
    : state.artifacts;
  return (
    <>
      <p className="help">
        Inspect reports and patches here. Applying changes is a separate step in
        Codex.
      </p>
      {state.selectedArtifact && (
        <button onClick={() => controller.selectArtifact()}>
          All artifacts
        </button>
      )}
      {artifacts.length ? (
        artifacts.map((artifact) => (
          <article className="artifact" key={artifact.id}>
            <div className="artifact-head">
              <strong>{artifact.title}</strong>
              <small>{artifact.type}</small>
              <button
                data-artifact={artifact.id}
                onClick={() =>
                  state.mode === "console"
                    ? controller.selectArtifact(artifact.id)
                    : controller.open({ kind: "artifact", artifact })
                }
              >
                Inspect
              </button>
              {state.mode === "console" && (
                <button onClick={() => downloadArtifact(artifact)}>
                  Download {artifact.type}
                </button>
              )}
            </div>
            <ArtifactContent artifact={artifact} />
          </article>
        ))
      ) : (
        <p className="muted">
          {state.selectedArtifact
            ? "This artifact is unavailable for the selected task."
            : "No artifacts yet."}
        </p>
      )}
    </>
  );
}
