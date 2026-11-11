import { type CSSProperties, useMemo } from "react";

import { LazyBlock } from "../../../shared/components/lazy-block/lazy-block";
import { chunks } from "../../../shared/utils/chunks";
import { highlightLines } from "../highlight";

/** Lines per lazily mounted block. */
const BLOCK_LINES = 200;
/** A line's height before it is measured: 11px text at 1.6 line height. */
const LINE_HEIGHT = 17.6;

type CodeViewProps = {
  code: string;
  language?: string;
  /** The first line's number, for an excerpt of a file. */
  startLine?: number;
};

/**
 * Highlighted source text with line numbers. Every line is kept; lines mount
 * in blocks near the visible area, so long files stay light in the DOM.
 */
export function CodeView({ code, language, startLine = 1 }: CodeViewProps) {
  const highlighted = useMemo(
    () => highlightLines(code.replace(/\n$/, ""), language),
    [code, language],
  );

  const blocks = useMemo(() => chunks(highlighted, BLOCK_LINES), [highlighted]);
  // The gutter fits the last number, with room for four digits at least.
  const digits = Math.max(4, String(startLine + highlighted.length - 1).length);

  return (
    <div
      className="code-view hljs"
      style={{ "--line-number-width": `${digits}ch` } as CSSProperties}
    >
      {blocks.map((lines, block) => (
        <LazyBlock
          key={block}
          eager={block === 0}
          estimate={lines.length * LINE_HEIGHT}
        >
          {lines.map((html, index) => (
            <div className="code-line" key={index}>
              <span className="line-number" aria-hidden>
                {startLine + block * BLOCK_LINES + index}
              </span>
              <code dangerouslySetInnerHTML={{ __html: html || " " }} />
            </div>
          ))}
        </LazyBlock>
      ))}
    </div>
  );
}
