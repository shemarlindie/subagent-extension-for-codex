import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { CodeBlock } from "../code-block";
import { codeLanguage } from "./markdown-code";

type MarkdownPreProps = ComponentProps<"pre"> & ExtraProps;

type SourceNode = {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: SourceNode[];
};

/** Source text of a parsed subtree, before highlighting adds markup. */
function sourceText(node: SourceNode): string {
  if (node.type === "text") return node.value ?? "";

  return node.children?.map(sourceText).join("") ?? "";
}

/** The fence's language, from the classes of the `code` element inside. */
function fenceLanguage(node: SourceNode | undefined): string | undefined {
  const classes = node?.children?.[0]?.properties?.className;

  return Array.isArray(classes) ? codeLanguage(classes.join(" ")) : undefined;
}

export function MarkdownPre({ node, className, children }: MarkdownPreProps) {
  // Markdown ends fenced code with a newline that is not part of the code.
  const text = node ? sourceText(node).replace(/\n$/, "") : "";

  return (
    <CodeBlock text={text} language={fenceLanguage(node)} className={className}>
      {children}
    </CodeBlock>
  );
}
