import {
  type ReactNode,
  type SyntheticEvent,
  useDeferredValue,
  useMemo,
  useState,
} from "react";

import { LazyBlock } from "../../../shared/components/lazy-block/lazy-block";
import { chunks } from "../../../shared/utils/chunks";
import {
  diffPath,
  type DiffRow,
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

/** The sign shown before each line of a diff. */
const DIFF_SIGNS: Record<"add" | "del" | "normal", string> = {
  add: "+",
  del: "−",
  normal: " ",
};

type DiffFileProps = {
  file: ParsedDiffFile;
  initiallyOpen: boolean;
  /** Controls whether the file is open; it otherwise keeps its own state. */
  open?: boolean;
  /** Shown instead of rows when the file has none. */
  emptyNote?: string;
  /** Buttons in the file's header; using them doesn't toggle the file. */
  actions?: ReactNode;
  /** Called when the reader opens or closes the file. */
  onOpenChange?: (open: boolean) => void;
  /** Data attributes for the file's section, such as an identifying key. */
  [data: `data-${string}`]: string | undefined;
};

export function DiffFile({
  file,
  initiallyOpen,
  open: controlledOpen,
  emptyNote = "No content changes",
  actions,
  onOpenChange,
  ...data
}: DiffFileProps) {
  const [ownOpen, setOpen] = useState(initiallyOpen),
    open = controlledOpen ?? ownOpen,
    deferredOpen = useDeferredValue(open),
    renderRows = open && deferredOpen,
    language = pathLanguage(diffPath(file)),
    renamed =
      file.from &&
      file.to &&
      file.from !== file.to &&
      !file.new &&
      !file.deleted;

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const details = event.currentTarget;

    // A file that renders open also fires toggle; only report a change.
    if (details.open !== open) {
      setOpen(details.open);
      onOpenChange?.(details.open);
    }

    // Collapsing from a header stuck at the top would leave the file above
    // the view; bring it back.
    if (!details.open) details.scrollIntoView({ block: "nearest" });
  }

  return (
    <details
      {...data}
      className="diff-file"
      open={open}
      onToggle={handleToggle}
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
          {rows.map((row, index) => renderDiffRow(row, index, language))}
        </LazyBlock>
      ))}
    </div>
  );
}

/** A hunk header, a note, or a line of code, keyed by its position in the file. */
function renderDiffRow(row: DiffRow, index: number, language?: string) {
  if (row.kind === "hunk")
    return (
      <div className="diff-hunk" key={index}>
        {row.content}
      </div>
    );

  if (row.kind === "note")
    return (
      <div className="diff-note" key={index}>
        {row.content}
      </div>
    );

  return (
    <div className={`diff-row ${row.type}`} key={index}>
      <span className="line-number" aria-hidden>
        {row.oldLine ?? ""}
      </span>
      <span className="line-number" aria-hidden>
        {row.newLine ?? ""}
      </span>
      <span className="diff-sign" aria-hidden>
        {DIFF_SIGNS[row.type]}
      </span>
      <code
        dangerouslySetInnerHTML={{
          __html: highlightLine(row.text, language) || " ",
        }}
      />
    </div>
  );
}
