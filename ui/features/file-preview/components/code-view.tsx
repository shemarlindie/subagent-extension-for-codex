import { useMemo } from "react";

import { highlightLines } from "../highlight";

type CodeViewProps = {
  code: string;
  language?: string;
};

/** Highlighted source text with line numbers. */
export function CodeView({ code, language }: CodeViewProps) {
  const lines = useMemo(
    () => highlightLines(code.replace(/\n$/, ""), language),
    [code, language],
  );

  return (
    <div className="code-view hljs">
      {lines.map((html, index) => (
        <div className="code-line" key={index}>
          <span className="line-number" aria-hidden>
            {index + 1}
          </span>
          <code dangerouslySetInnerHTML={{ __html: html || " " }} />
        </div>
      ))}
    </div>
  );
}
