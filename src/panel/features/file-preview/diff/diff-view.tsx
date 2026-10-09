import { useMemo } from "react";

import { parseDiffFiles } from "../file-format";
import { DiffFile } from "./diff-file";

type DiffViewProps = {
  content: string;
};

export function DiffView({ content }: DiffViewProps) {
  const files = useMemo(() => parseDiffFiles(content), [content]);

  return (
    <div className="diff-view">
      {files.map((file, index) => (
        // Large diffs open collapsed so the file list is scannable.
        <DiffFile key={index} file={file} initiallyOpen={files.length <= 8} />
      ))}
    </div>
  );
}
