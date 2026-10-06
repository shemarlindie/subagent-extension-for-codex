import { useMemo } from "react";

import { highlightLines } from "../highlight";

type CodeViewProps = {
  code: string;
  language?: string;
  className?: string;
};

/** Highlighted source text with line numbers. */
export function CodeView({ code, language, className }: CodeViewProps) {
  const lines = useMemo(
    () => highlightLines(code.replace(/\n$/, ""), language),
    [code, language],
  );

  return (
    <div className={["code-view", "hljs", className].filter(Boolean).join(" ")}>
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
