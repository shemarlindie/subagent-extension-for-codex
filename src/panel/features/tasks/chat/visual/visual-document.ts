/** What a visual's frame tells the panel. */
type VisualFrameMessage =
  | { type: "visual-height"; height: number }
  | { type: "visual-link"; href: string };

/** A frame message, from data a visual's own scripts can also post. */
export function frameMessage(data: unknown): VisualFrameMessage | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { type, height, href } = data as Record<string, unknown>;

  if (type === "visual-height" && typeof height === "number") {
    return Number.isFinite(height) ? { type, height } : undefined;
  }

  return type === "visual-link" && typeof href === "string"
    ? { type, href }
    : undefined;
}

/**
 * Inline code and data URLs only. The panel's own CSP already blocks the
 * network, and this keeps a visual offline wherever the panel runs.
 */
const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/** Content can grow with its frame, so the frame stops here and scrolls. */
export const MAX_VISUAL_HEIGHT = 1600;

/**
 * Reports the content's height, and hands link clicks to the panel, since
 * the sandbox lets the frame open nothing itself. Fragment links stay inside.
 * A frame that fits its content can't scroll, even by a rounded pixel, or it
 * would keep the wheel from scrolling Chat.
 */
const FRAME_SCRIPT = `(() => {
  const post = (message) => parent.postMessage(message, "*");
  const root = document.documentElement;
  const report = () => {
    const height = Math.ceil(root.scrollHeight);
    root.style.overflow = height > ${MAX_VISUAL_HEIGHT} ? "auto" : "hidden";
    post({ type: "visual-height", height });
  };
  const observer = new ResizeObserver(report);
  observer.observe(root);
  addEventListener("DOMContentLoaded", () => observer.observe(document.body));
  addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    const href = link?.getAttribute("href") ?? link?.getAttribute("xlink:href");
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    post({ type: "visual-link", href });
  });
})();`;

/** Panel tokens a visual can use, by the names its tool description gives. */
const THEME_TOKENS: [name: string, panel: string][] = [
  ["--text", "--text"],
  ["--muted", "--muted"],
  ["--background", "--bg"],
  ["--surface", "--surface"],
  ["--border", "--line"],
  ["--accent", "--accent"],
  ["--font-sans", "--font-sans"],
  ["--font-mono", "--font-mono"],
];

/**
 * The panel's theme as CSS for a visual's root. The frame matches the panel's
 * color scheme, or the browser paints it an opaque default background.
 */
export function visualThemeCss(root: Element) {
  const style = getComputedStyle(root);

  const tokens = THEME_TOKENS.map(
    ([name, panel]) => `${name}: ${style.getPropertyValue(panel).trim()};`,
  );

  return `:root { ${tokens.join(" ")} color-scheme: ${style.colorScheme || "normal"}; }`;
}

/**
 * The frame document for a visual's code. The policy and script come first in
 * the head, so they apply before any of the visual's own markup. A visual
 * that's a whole HTML document still renders, since the parser folds its
 * `html` and `head` tags into this one.
 */
export function visualDocument(code: string, themeCss: string) {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    `<script>${FRAME_SCRIPT}</script>`,
    `<style>${themeCss} :root { color: var(--text); font-family: var(--font-sans); } body { margin: 0; }</style>`,
    "</head><body>",
    code,
    "</body></html>",
  ].join("\n");
}
