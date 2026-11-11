import { memo, useId, useMemo } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { MarkdownCode } from "./markdown-code";
import { MarkdownImage } from "./markdown-image";
import { MarkdownLink } from "./markdown-link";
import { MarkdownPre } from "./markdown-pre";

type MarkdownViewProps = {
  /**
   * Markdown; embedded HTML shows as literal text, so prose like `<Foo>` stays
   * visible. Parts render one by one, so a part that stays the same isn't
   * parsed again. They must render as their joined text would, except that a
   * heading repeated in another part gets the same id.
   */
  content: string | readonly string[];
};

type MarkdownPartProps = {
  content: string;
  prefix: string;
  rehypePlugins: Options["rehypePlugins"];
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
  const prefix = `${useId()}-`;

  const rehypePlugins = useMemo<Options["rehypePlugins"]>(
    () => [[rehypeSlug, { prefix }]],
    [prefix],
  );

  const parts = typeof content === "string" ? [content] : content;

  return (
    <div className="markdown-body" data-id-prefix={prefix}>
      {parts.map((part, index) => (
        <MarkdownPart
          // Parts only grow at the end, so an index names the same part.
          key={index}
          content={part}
          prefix={prefix}
          rehypePlugins={rehypePlugins}
        />
      ))}
    </div>
  );
});

const MarkdownPart = memo(function MarkdownPart({
  content,
  prefix,
  rehypePlugins,
}: MarkdownPartProps) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={{ clobberPrefix: prefix }}
      components={COMPONENTS}
    >
      {content}
    </Markdown>
  );
});
