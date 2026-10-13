import { type ComponentProps, useState } from "react";

import { loadableImage } from "./markdown-urls";

type MarkdownImageProps = ComponentProps<"img"> & { node?: unknown };

/** An image, or its alt text when it cannot or did not load. */
export function MarkdownImage({
  node: _node,
  src,
  alt,
  ...rest
}: MarkdownImageProps) {
  // The source that failed, so a new source gets its own attempt.
  const [failed, setFailed] = useState<string>();
  const source = typeof src === "string" ? src : undefined;

  if (!loadableImage(source) || failed === source) {
    return (
      // A data URI is too long to be a useful tooltip.
      <span
        className="markdown-image-missing"
        title={source?.startsWith("data:") ? undefined : source}
      >
        {alt || "Image"}
      </span>
    );
  }

  return (
    <img
      {...rest}
      src={source}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(source)}
    />
  );
}
