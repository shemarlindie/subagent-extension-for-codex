import { defaultUrlTransform } from "react-markdown";

/** How a Markdown link's target is treated. */
export type LinkKind = "fragment" | "external" | "file" | "text";

/** A line suffix after a colon: `:42`, `:42-50` or `:42:7`. */
const COLON_LINE = String.raw`:\d+(?:[-:]\d+)?`;

/** A line suffix: a colon form, `#L42` or `#L42-L50`. */
const LINE_SUFFIX = new RegExp(
  String.raw`(?:${COLON_LINE}|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$`,
);

/** A root file name with a colon line suffix, such as `Makefile:12`. */
const ROOT_FILE_LINE = new RegExp(String.raw`^[^:/?#]+${COLON_LINE}$`);

/**
 * The file path a link names, without a line suffix, since hosts open a file
 * without a position. Undefined for a URL with a scheme, host or query.
 */
export function linkedFilePath(href: string) {
  const path = href.replace(LINE_SUFFIX, "");
  if (!path || /^[a-z][a-z\d+.-]*:|^\/\/|[?#]/i.test(path)) return undefined;

  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

/**
 * Fragments jump within the same rendered Markdown; web and mail links open
 * outside the panel. A relative or absolute path is a file link, which opens
 * where the view provides a file opener. Anything else, such as a URL the
 * renderer emptied as unsafe, has nowhere to go from the panel and shows as
 * text.
 */
export function linkKind(href: string | undefined): LinkKind {
  if (!href) return "text";
  if (href.startsWith("#")) return href.length > 1 ? "fragment" : "text";
  if (/^(https?:|mailto:)/i.test(href)) return "external";

  return linkedFilePath(href) ? "file" : "text";
}

/**
 * The default URL sanitizer, except that it keeps a file name with a line
 * suffix, such as `README.md:12` or `Makefile:12`, which it would read as a
 * scheme.
 */
export function markdownUrl(url: string) {
  return defaultUrlTransform(url) || (ROOT_FILE_LINE.test(url) ? url : "");
}
