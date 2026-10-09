import { type ReactNode, useDeferredValue, useMemo, useState } from "react";

import { LazyBlock } from "../../../shared/components/lazy-block/lazy-block";
import { chunks } from "../../../shared/utils/chunks";
import {
  diffPath,
  diffRows,
  type ParsedDiffFile,
  pathLanguage,
} from "../file-format";
import { highlightLine } from "../highlight";
import { Progress } from "../progress";
import { DiffStat } from "./diff-stat";

/** Rows per lazily mounted block. */
const BLOCK_ROWS = 200;
/** A diff row's height before it is measured: 11px text at 1.6 line height. */
const ROW_HEIGHT = 17.6;

type DiffFileProps = {
  file: ParsedDiffFile;
  initiallyOpen: boolean;
  /** Shown instead of rows when the file has none. */
  emptyNote?: string;
  /** Buttons in the file's header; using them doesn't toggle the file. */
  actions?: ReactNode;
};

export function DiffFile({
  file,
  initiallyOpen,
  emptyNote = "No content changes",
  actions,
}: DiffFileProps) {
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
        {actions && (
          // A click in the summary would also open or close the file.
          <span
            className="diff-actions"
            onClick={(event) => event.preventDefault()}
          >
            {actions}
          </span>
        )}
      </summary>
      {open && !deferredOpen && (
        <Progress
          label={`Rendering ${diffPath(file)}`}
          className="diff-progress"
        />
      )}
      {/* A collapsed file unmounts its rows. */}
      {renderRows && (
        <DiffRows file={file} language={language} emptyNote={emptyNote} />
      )}
    </details>
  );
}

type DiffRowsProps = {
  file: ParsedDiffFile;
  language?: string;
  emptyNote: string;
};

/** A file's rows in blocks; only blocks near the visible area mount. */
function DiffRows({ file, language, emptyNote }: DiffRowsProps) {
  const blocks = useMemo(() => chunks(diffRows(file), BLOCK_ROWS), [file]);

  return (
    <div className="diff-table hljs">
      {blocks.length === 0 && <p className="help diff-empty">{emptyNote}</p>}
      {blocks.map((rows, blockIndex) => (
        <LazyBlock
          key={blockIndex}
          eager={blockIndex === 0}
          estimate={rows.length * ROW_HEIGHT}
        >
          {rows.map((row, index) =>
            row.kind === "hunk" ? (
              <div className="diff-hunk" key={index}>
                {row.content}
              </div>
            ) : (
              <div className={`diff-row ${row.type}`} key={index}>
                <span className="line-number" aria-hidden>
                  {row.oldLine ?? ""}
                </span>
                <span className="line-number" aria-hidden>
                  {row.newLine ?? ""}
                </span>
                <span className="diff-sign" aria-hidden>
                  {row.type === "add" ? "+" : row.type === "del" ? "−" : " "}
                </span>
                <code
                  dangerouslySetInnerHTML={{
                    __html: highlightLine(row.text, language) || " ",
                  }}
                />
              </div>
            ),
          )}
        </LazyBlock>
      ))}
    </div>
  );
}
