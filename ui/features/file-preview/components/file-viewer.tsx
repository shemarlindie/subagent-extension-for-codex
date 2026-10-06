import { memo, useMemo } from "react";

import { ResultReport } from "../../tasks/evidence/result-report";
import {
  countDelimitedRows,
  delimiterOf,
  fileSource,
  type FileView,
  imageSource,
  MAX_PREVIEW_LINES,
  parseDelimited,
  type PreviewFile,
  resultShape,
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
  const report = useMemo(
    () => (view === "report" ? resultShape(file.content) : undefined),
    [file.content, view],
  );

  // Parses only the rows the table shows, and counts the rest.
  const table = useMemo(
    () =>
      view === "table"
        ? {
            rows: parseDelimited(
              file.content,
              delimiterOf(file),
              MAX_PREVIEW_LINES + 1,
            ),
            totalRows: countDelimitedRows(file.content),
          }
        : undefined,
    [file, view],
  );

  const source = useMemo(
    () => (view === "source" ? fileSource(file) : undefined),
    [file, view],
  );

  switch (view) {
    case "report":
      return <ResultReport result={report} />;
    case "preview":
      return <MarkdownView content={file.content} />;
    case "diff":
      return <DiffView content={file.content} />;
    case "table":
      return <TableView {...table!} />;
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
