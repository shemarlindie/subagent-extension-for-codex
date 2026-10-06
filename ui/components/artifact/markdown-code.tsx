import type { ComponentProps } from "react";

import { highlightLines } from "../../utils/highlight";

type MarkdownCodeProps = ComponentProps<"code">;

export function MarkdownCode({
  className,
  children,
  ...rest
}: MarkdownCodeProps) {
  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];

  if (!language) return <code {...rest}>{children}</code>;

  return (
    <code
      className={`hljs ${className}`}
      dangerouslySetInnerHTML={{
        __html: highlightLines(
          String(children).replace(/\n$/, ""),
          language,
        ).join("\n"),
      }}
    />
  );
}
