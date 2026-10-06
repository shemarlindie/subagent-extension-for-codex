import { memo, useMemo } from "react";

import {
  delimiterOf,
  fileSource,
  type FileView,
  imageSource,
  parseDelimited,
  type PreviewFile,
} from "../file-format";
import { CodeView } from "./code-view";
import { DiffView } from "./diff-view";
import { MarkdownView } from "./markdown-view";
import { TableView } from "./table-view";

type FileViewerProps = {
  file: PreviewFile;
  view: FileView;
};

// Skip rebuilding a large view tree during urgent tab switches.
export const FileViewer = memo(function FileViewer({
  file,
  view,
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
  }
});
