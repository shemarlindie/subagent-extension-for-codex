import type { ChatVisual } from "../../../../../shared/tasks/conversation/chat.js";
import { savedVisualDocument, visualThemeCss } from "./visual-document";

type ExportedVisual = Pick<ChatVisual, "visual" | "title" | "code">;

/**
 * The title as a lowercase ASCII slug, or the visual's number when the title
 * has no ASCII letters or digits. Accents drop, so "Café" becomes "cafe".
 */
export function visualFileName(
  { visual, title }: ExportedVisual,
  extension: "html",
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
