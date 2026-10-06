import { MAX_PREVIEW_LINES } from "../../utils/artifact-view";

type TableViewProps = {
  /** The header row first; may stop short of the whole file. */
  rows: string[][];
  /** Rows in the whole file, header included, when `rows` is a prefix. */
  totalRows?: number;
  maxRows?: number;
};

export function TableView({
  rows,
  totalRows = rows.length,
  maxRows = MAX_PREVIEW_LINES,
}: TableViewProps) {
  const [head = [], ...body] = rows,
    shown = body.slice(0, maxRows),
    more = totalRows - 1 - shown.length;

  return (
    <div className="table-view">
      <table>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {head.map((_, index) => (
                <td key={index}>{row[index] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && (
        <p className="code-more help">
          {more.toLocaleString()} more {more === 1 ? "row" : "rows"}
        </p>
      )}
    </div>
  );
}
