import { useMemo } from "react";

import { LazyBlock } from "../../../shared/components/lazy-block";
import { chunks } from "../../../shared/utils/chunks";
import { highlightLines } from "../highlight";

/** Lines per lazily mounted block. */
const BLOCK_LINES = 200;
/** A line's height before it is measured: 11px text at 1.6 line height. */
const LINE_HEIGHT = 17.6;

type CodeViewProps = {
  code: string;
  language?: string;
};

/**
 * Highlighted source text with line numbers. Every line is kept; lines mount
 * in blocks near the visible area, so long files stay light in the DOM.
 */
export function CodeView({ code, language }: CodeViewProps) {
  const blocks = useMemo(
    () =>
      chunks(highlightLines(code.replace(/\n$/, ""), language), BLOCK_LINES),
    [code, language],
  );

  return (
    <div className="code-view hljs">
      {blocks.map((lines, block) => (
        <LazyBlock
          key={block}
          eager={block === 0}
          estimate={lines.length * LINE_HEIGHT}
        >
          {lines.map((html, index) => (
            <div className="code-line" key={index}>
              <span className="line-number" aria-hidden>
                {block * BLOCK_LINES + index + 1}
              </span>
              <code dangerouslySetInnerHTML={{ __html: html || " " }} />
            </div>
          ))}
        </LazyBlock>
      ))}
    </div>
  );
}
