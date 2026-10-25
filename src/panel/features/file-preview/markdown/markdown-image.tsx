import type { ComponentProps } from "react";

type MarkdownImageProps = ComponentProps<"img"> & { node?: unknown };

/**
 * An image's alt text, with its source in a tooltip. Images never load: a
 * relative path cannot resolve, and a remote URL written by a worker could
 * carry data out when the image loads. The renderer already empties `data:`
 * sources as unsafe.
 */
export function MarkdownImage({ src, alt }: MarkdownImageProps) {
  return (
    <span
      className="markdown-image-missing"
      title={typeof src === "string" && src ? src : undefined}
    >
      {alt || "Image"}
    </span>
  );
}
