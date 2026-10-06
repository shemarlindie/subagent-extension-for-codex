import { useMemo } from "react";

import { parseArtifactDiff } from "../../core/artifact-file";
import { ArtifactDiffFile } from "./artifact-diff-file";

type DiffViewProps = {
  content: string;
};

export function DiffView({ content }: DiffViewProps) {
  const files = useMemo(() => parseArtifactDiff(content), [content]);

  return (
    <div className="diff-view">
      {files.map((file, index) => (
        // Large diffs open collapsed so the file list is scannable.
        <ArtifactDiffFile
          key={index}
          file={file}
          initiallyOpen={files.length <= 8}
        />
      ))}
    </div>
  );
}
