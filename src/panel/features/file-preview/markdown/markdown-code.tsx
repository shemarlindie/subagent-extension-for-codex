import type { ComponentProps } from "react";

import { scalarText } from "../../../../shared/text";
import { highlightLines } from "../highlight";

type MarkdownCodeProps = ComponentProps<"code"> & { node?: unknown };

/** A fenced block's language from its `language-*` class. */
export const codeLanguage = (className: string | undefined) =>
  // Info strings can hold symbols, as in c++ or objective-c.
  /(?:^|\s)language-(\S+)/.exec(className ?? "")?.[1];

export function MarkdownCode({
  node: _node,
  className,
  children,
  ...rest
}: MarkdownCodeProps) {
  const language = codeLanguage(className);

  if (!language) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  return (
    <code
      {...rest}
      className={`hljs ${className}`}
      dangerouslySetInnerHTML={{
        __html: highlightLines(
          scalarText(children).replace(/\n$/, ""),
          language.toLowerCase(),
        ).join("\n"),
      }}
    />
  );
}
