import { useMemo } from "react";

import { MAX_PREVIEW_LINES } from "../../utils/artifact-view";
import { highlightLines } from "../../utils/highlight";

type CodeViewProps = {
  code: string;
  language?: string;
  maxLines?: number;
  className?: string;
};

/** Highlighted source text with line numbers. */
export function CodeView({
  code,
  language,
  maxLines = MAX_PREVIEW_LINES,
  className,
}: CodeViewProps) {
  const lines = useMemo(() => {
    const all = code.replace(/\n$/, "").split("\n");

    return {
      shown: highlightLines(all.slice(0, maxLines).join("\n"), language),
      hidden: Math.max(0, all.length - maxLines),
    };
  }, [code, language, maxLines]);

  return (
    <div className={["code-view", "hljs", className].filter(Boolean).join(" ")}>
      {lines.shown.map((html, index) => (
        <div className="code-line" key={index}>
          <span className="line-number" aria-hidden>
            {index + 1}
          </span>
          <code dangerouslySetInnerHTML={{ __html: html || " " }} />
        </div>
      ))}
      {lines.hidden > 0 && (
        <p className="code-more help">
          {lines.hidden.toLocaleString()} more{" "}
          {lines.hidden === 1 ? "line" : "lines"}
        </p>
      )}
    </div>
  );
}
