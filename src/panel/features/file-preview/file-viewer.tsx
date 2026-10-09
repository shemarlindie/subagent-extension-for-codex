import { memo, useMemo } from "react";

import { CodeView } from "./code/code-view";
import { DiffFile } from "./diff/diff-file";
import { DiffView } from "./diff/diff-view";
import {
  delimiterOf,
  fileSource,
  type FileView,
  imageSource,
  type ParsedDiffFile,
  parseDelimited,
  type PreviewFile,
} from "./file-format";
import { MarkdownView } from "./markdown/markdown-view";
import { TableView } from "./table/table-view";

type FileViewerProps = {
  file: PreviewFile;
  view: FileView;
  /** The file's own diff, for the `changes` view. */
  diff?: ParsedDiffFile;
};

// Skip rebuilding a large view tree during urgent tab switches.
export const FileViewer = memo(function FileViewer({
  file,
  view,
  diff,
}: FileViewerProps) {
  const rows = useMemo(
    () =>
      view === "table" ? parseDelimited(file.content, delimiterOf(file)) : [],
    [file, view],
  );

  const source = useMemo(
    () => (view === "source" ? fileSource(file) : undefined),
    [file, view],
  );

  switch (view) {
    case "preview":
      return <MarkdownView content={file.content} />;
    case "diff":
      return <DiffView content={file.content} />;
    case "table":
      return <TableView rows={rows} />;
    case "image":
      return (
        <div className="image-view">
          <img src={imageSource(file)} alt={file.path} />
        </div>
      );
    case "source":
      return <CodeView {...source!} />;
    case "changes":
      return (
        diff && (
          <div className="diff-view">
            <DiffFile file={diff} initiallyOpen />
          </div>
        )
      );
  }
});
