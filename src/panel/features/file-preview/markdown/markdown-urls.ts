/** How a Markdown link's target is treated. */
export type LinkKind = "fragment" | "external" | "text";

/**
 * Fragments jump within the same rendered Markdown; web and mail links open
 * outside the panel. Anything else, such as a relative file path or a URL the
 * renderer emptied as unsafe, has nowhere to go from the panel and shows as text.
 */
export function linkKind(href: string | undefined): LinkKind {
  if (!href) return "text";
  if (href.startsWith("#")) return href.length > 1 ? "fragment" : "text";

  return /^(https?:|mailto:)/i.test(href) ? "external" : "text";
}

/** Images load only from the web or inline data; relative paths cannot resolve. */
export function loadableImage(src: string | undefined) {
  return Boolean(src && /^(https?:|data:image\/)/i.test(src));
}
