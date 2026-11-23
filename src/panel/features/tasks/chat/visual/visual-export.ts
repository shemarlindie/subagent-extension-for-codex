import type { ChatVisual } from "../../../../../shared/tasks/conversation/chat.js";
import { savedVisualDocument } from "./visual-document";

type ExportedVisual = Pick<ChatVisual, "visual" | "title" | "code">;

/**
 * The title as a lowercase ASCII slug, or the visual's number when the title
 * has no ASCII letters or digits. Accents drop, so "Café" becomes "cafe".
 */
export function visualFileName(
  { visual, title }: ExportedVisual,
  extension: string,
) {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");

  return `${slug || `visual-${visual}`}.${extension}`;
}

/** The visual as an HTML page in the given theme. */
export function visualPageFile(visual: ExportedVisual, themeCss: string) {
  return new File(
    [savedVisualDocument(visual.title, visual.code, themeCss)],
    visualFileName(visual, "html"),
    { type: "text/html" },
  );
}
