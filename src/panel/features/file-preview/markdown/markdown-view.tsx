import { memo, useId, useMemo } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { MarkdownCode } from "./markdown-code";
import { MarkdownImage } from "./markdown-image";
import { MarkdownLink } from "./markdown-link";
import { MarkdownPre } from "./markdown-pre";

type MarkdownViewProps = {
  /** Markdown; embedded HTML shows as literal text, so prose like `<Foo>` stays visible. */
  content: string;
};

const COMPONENTS: Components = {
  a: MarkdownLink,
  code: MarkdownCode,
  img: MarkdownImage,
  pre: MarkdownPre,
};

const REMARK_PLUGINS = [remarkGfm];

// Chat and Activity rerender their rows as events arrive; unchanged text is
// not parsed again.
export const MarkdownView = memo(function MarkdownView({
  content,
}: MarkdownViewProps) {
  // Footnote and heading ids are unique per view, so several messages can
  // each have [^1] or a "Summary" heading. Links resolve through the prefix.
  const prefix = `${useId()}-`,
    rehypePlugins = useMemo<Options["rehypePlugins"]>(
      () => [[rehypeSlug, { prefix }]],
      [prefix],
    );

  return (
    <div className="markdown-body" data-id-prefix={prefix}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={{ clobberPrefix: prefix }}
        components={COMPONENTS}
      >
        {content}
      </Markdown>
    </div>
  );
});
