import type { Artifact } from "../core/types";
import { Button } from "./button";
import { useController, useSnapshot } from "./controller-context";

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

  const artifacts = state.artifacts;

  return (
    <>
      <p className="help">Inspect reports and patches here.</p>
      {artifacts.map((artifact) => (
        <article className="artifact" key={artifact.id}>
          <div className="artifact-head">
            <strong>{artifact.title}</strong>
            <small>{artifact.type}</small>
            <Button
              data-artifact={artifact.id}
              onClick={() => controller.open({ kind: "artifact", artifact })}
            >
              Inspect
            </Button>
          </div>
          <ArtifactContent artifact={artifact} />
        </article>
      ))}
    </>
  );
}
