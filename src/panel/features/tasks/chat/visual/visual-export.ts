import type { ChatVisual } from "../../../../../shared/tasks/conversation/chat.js";
import { savedVisualDocument, visualThemeCss } from "./visual-document";
import { pngSize, type Size } from "./visual-image";

type ExportedVisual = Pick<ChatVisual, "visual" | "title" | "code">;

/**
 * The title as a lowercase ASCII slug, or the visual's number when the title
 * has no ASCII letters or digits. Accents drop, so "Café" becomes "cafe".
 */
export function visualFileName(
  { visual, title }: ExportedVisual,
  extension: "html" | "png",
) {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");

  return `${slug || `visual-${visual}`}.${extension}`;
}

/** The visual as a page, in the theme `root` has now. */
export function visualPageFile(visual: ExportedVisual, root: Element) {
  const page = savedVisualDocument(
    visual.title,
    visual.code,
    visualThemeCss(root),
  );

  return new File([page], visualFileName(visual, "html"), {
    type: "text/html",
  });
}

/**
 * A prepared SVG with the theme `root` has now, and the root color, font and
 * background, in a style element. An anonymous layer lets the SVG's own rules
 * win, as in Chat. The color and font skip a root that sets them as
 * attributes, which in Chat beat what the root inherits but lose to any style
 * rule.
 */
function themedSvg(svg: string, root: Element) {
  const file = new DOMParser().parseFromString(svg, "image/svg+xml");

  const style = file.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `@layer { ${visualThemeCss(root)} :root { background: var(--background); } :root:not([color]) { color: var(--text); } :root:not([font-family]) { font-family: var(--font-sans); } :root:not([font-size]) { font-size: var(--font-size); } }`;
  file.documentElement.prepend(style);

  return new XMLSerializer().serializeToString(file.documentElement);
}

/**
 * A prepared SVG drawn as a PNG, in the theme `root` has now. The SVG paints
 * its own background. A data URL image, since Codex blocks blob URL images.
 */
export async function visualPngFile(
  visual: ExportedVisual,
  svg: string,
  size: Size,
  root: Element,
) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themedSvg(svg, root))}`;
  await image.decode();

  const canvas = document.createElement("canvas");
  ({ width: canvas.width, height: canvas.height } = pngSize(size));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);

  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );

  if (!png) throw new Error("Couldn't draw the PNG image.");

  return new File([png], visualFileName(visual, "png"), { type: "image/png" });
}
