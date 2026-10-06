import { useDeferredValue, useState } from "react";

import { type DiffFile, diffPath, pathLanguage } from "../artifact-file";
import { highlightLine } from "../highlight";
import { ArtifactProgress } from "./artifact-progress";
import { DiffStat } from "./diff-stat";

type ArtifactDiffFileProps = {
  file: DiffFile;
  initiallyOpen: boolean;
};

export function ArtifactDiffFile({
  file,
  initiallyOpen,
}: ArtifactDiffFileProps) {
  const [open, setOpen] = useState(initiallyOpen),
    deferredOpen = useDeferredValue(open),
    renderRows = open && deferredOpen,
    language = pathLanguage(diffPath(file)),
    renamed =
      file.from &&
      file.to &&
      file.from !== file.to &&
      !file.new &&
      !file.deleted;

  return (
    <details
      className="diff-file"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="diff-path">
          {renamed ? `${file.from} → ${file.to}` : diffPath(file)}
        </span>
        {file.new && <span className="diff-tag">new</span>}
        {file.deleted && <span className="diff-tag">deleted</span>}
        <DiffStat additions={file.additions} deletions={file.deletions} />
      </summary>
      {open && !deferredOpen && (
        <ArtifactProgress
          label={`Rendering ${diffPath(file)}`}
          className="diff-progress"
        />
      )}
      {renderRows && (
        <div className="diff-table hljs">
          {file.chunks.length === 0 && (
            <p className="help diff-empty">No content changes</p>
          )}
          {file.chunks.map((chunk, chunkIndex) => (
            <div className="diff-chunk" key={chunkIndex}>
              <div className="diff-hunk">{chunk.content}</div>
              {chunk.changes.map((change, index) => {
                const oldLine =
                  change.type === "normal"
                    ? change.ln1
                    : change.type === "del"
                      ? change.ln
                      : undefined;

                const newLine =
                  change.type === "normal"
                    ? change.ln2
                    : change.type === "add"
                      ? change.ln
                      : undefined;

                const text = change.content.slice(1);

                return (
                  <div className={`diff-row ${change.type}`} key={index}>
                    <span className="line-number" aria-hidden>
                      {oldLine ?? ""}
                    </span>
                    <span className="line-number" aria-hidden>
                      {newLine ?? ""}
                    </span>
                    <span className="diff-sign" aria-hidden>
                      {change.type === "add"
                        ? "+"
                        : change.type === "del"
                          ? "−"
                          : " "}
                    </span>
                    <code
                      dangerouslySetInnerHTML={{
                        __html: highlightLine(text, language) || " ",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
