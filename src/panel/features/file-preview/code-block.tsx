import type { ReactNode } from "react";

import { CopyButton } from "../../shared/components/copy-button/copy-button";

type CodeBlockProps = {
  /** The exact text the copy action writes. */
  text: string;
  /** The fence's language, shown in the header when present. */
  language?: string;
  className?: string;
  children: ReactNode;
};

/** A preformatted block under a header with its language and a copy action. */
export function CodeBlock({
  text,
  language,
  className,
  children,
}: CodeBlockProps) {
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-language">{language}</span>
        <CopyButton text={text} label="Copy code" iconOnly iconSize={12} />
      </div>
      <pre className={className}>{children}</pre>
    </div>
  );
}
