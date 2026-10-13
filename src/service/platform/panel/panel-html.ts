import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const copies = new Map<string, string>();

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Keeps a copy of the built panel page from startup, for when a plugin update
 * removes this installation before the service hands over. A page that
 * doesn't exist yet (a test or partial build) is read when first requested.
 */
export function preloadPanelHtml(path: string) {
  if (copies.has(path)) return;

  try {
    copies.set(path, readFileSync(path, "utf8"));
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

/**
 * The built panel page, read on each request so a rebuilt UI shows without
 * a restart. Once the file is gone, the last copy is served.
 */
export async function readPanelHtml(path: string) {
  try {
    const html = await readFile(path, "utf8");
    copies.set(path, html);

    return html;
  } catch (error) {
    const copy = copies.get(path);
    if (!missing(error) || copy === undefined) throw error;

    return copy;
  }
}
