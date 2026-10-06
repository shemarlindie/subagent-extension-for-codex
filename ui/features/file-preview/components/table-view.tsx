import { useMemo } from "react";

import { LazyBlock } from "../../../shared/components/lazy-block";
import { chunks } from "../../../shared/utils/chunks";

/** Rows per lazily mounted table body. */
const BLOCK_ROWS = 200;
/** A row's height before it is measured: 12px text, padding and border. */
const ROW_HEIGHT = 27;

type TableViewProps = {
  /** The header row first. */
  rows: string[][];
};

/**
 * A table of every row. Rows mount in bodies of 200 near the visible area,
 * so tables with tens of thousands of rows stay light in the DOM.
 */
export function TableView({ rows }: TableViewProps) {
  const head = rows[0] ?? [],
    blocks = useMemo(() => chunks(rows.slice(1), BLOCK_ROWS), [rows]);

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
        {blocks.map((block, blockIndex) => (
          <LazyBlock
            key={blockIndex}
            as="tbody"
            eager={blockIndex === 0}
            estimate={block.length * ROW_HEIGHT}
          >
            {block.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {head.map((_, index) => (
                  <td key={index}>{row[index] ?? ""}</td>
                ))}
              </tr>
            ))}
          </LazyBlock>
        ))}
      </table>
    </div>
  );
}
