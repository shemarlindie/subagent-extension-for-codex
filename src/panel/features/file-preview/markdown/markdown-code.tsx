import type { ComponentProps } from "react";

import { highlightLines } from "../highlight";

type MarkdownCodeProps = ComponentProps<"code"> & { node?: unknown };

export function MarkdownCode({
  node: _node,
  className,
  children,
  ...rest
}: MarkdownCodeProps) {
  // Info strings can hold symbols, as in c++ or objective-c.
  const language = /(?:^|\s)language-(\S+)/.exec(className ?? "")?.[1];

  if (!language)
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );

  return (
    <code
      {...rest}
      className={`hljs ${className}`}
      dangerouslySetInnerHTML={{
        __html: highlightLines(
          String(children).replace(/\n$/, ""),
          language.toLowerCase(),
        ).join("\n"),
      }}
    />
  );
}
