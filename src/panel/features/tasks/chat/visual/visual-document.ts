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

/** The style element that holds the panel's theme, which the panel updates. */
const THEME_ID = "visual-theme";

/**
 * Reports the content's height, applies the panel's theme updates, and hands
 * link clicks to the panel, since the sandbox lets the frame open nothing
 * itself. Fragment links stay in the document through `location.hash`, since
 * the frame resolves their `href` against `about:blank` and would navigate
 * away from the visual.
 *
 * The root's box measures the content, and the body's scroll height adds
 * absolutely positioned content past it, since the document's style makes the
 * body their containing block. The root's own scroll height never drops below
 * the frame's, so a frame measured by it could never shrink. Content such as a
 * popover can appear without resizing the root, through the DOM or CSS states
 * like `:hover`, `:focus-within`, `:checked` and `:target`, so DOM changes, the
 * events behind those states and finished transitions report too. A frame that
 * fits its content can't scroll, even by a rounded pixel, or it would keep the
 * wheel from scrolling Chat.
 */
const FRAME_SCRIPT = `(() => {
  const post = (message) => parent.postMessage(message, "*");
  const root = document.documentElement;
  let reported;
  const report = () => {
    const height = Math.ceil(
      Math.max(root.getBoundingClientRect().height, document.body?.scrollHeight ?? 0),
    );
    if (height === reported) return;
    reported = height;
    root.style.overflow = height > ${MAX_VISUAL_HEIGHT} ? "auto" : "hidden";
    post({ type: "visual-height", height });
  };
  new ResizeObserver(report).observe(root);
  new MutationObserver(report).observe(root, {
    subtree: true, childList: true, attributes: true, characterData: true,
  });
  for (const type of [
    "pointerover", "pointerout", "focusin", "focusout", "input", "change",
    "hashchange", "transitionend", "animationend",
  ]) {
    addEventListener(type, report);
  }
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "visual-theme") return;
    document.getElementById("${THEME_ID}").textContent = event.data.css;
  });
  addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    const href = link?.getAttribute("href") ?? link?.getAttribute("xlink:href");
    if (!href) return;
    event.preventDefault();
    if (href.startsWith("#")) location.hash = href;
    else post({ type: "visual-link", href });
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

const BASE_STYLE =
  ":root { color: var(--text); font-family: var(--font-sans); } body { margin: 0; position: relative; }";

/**
 * A document for a visual's code. The policy comes first in the head, so it
 * applies before anything else. A visual that's a whole HTML document still
 * renders, since the parser folds its `html` and `head` tags into this one.
 */
function visualPage(head: string[], code: string) {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    ...head,
    `<style>${BASE_STYLE}</style>`,
    "</head><body>",
    code,
    "</body></html>",
  ].join("\n");
}

/** The frame document, whose script runs before the visual's own markup. */
export function visualDocument(code: string, themeCss: string) {
  return visualPage(
    [
      `<script>${FRAME_SCRIPT}</script>`,
      `<style id="${THEME_ID}">${themeCss}</style>`,
    ],
    code,
  );
}

/**
 * A visual as a page of its own, in the theme it was saved in. Without the
 * frame script it scrolls and its links navigate. In Chat the panel shows
 * through the frame, so the page paints the panel's background itself. Its
 * scripts keep running, so interactive visuals work. The CSP stops their
 * requests, but nothing in a page can stop a script from navigating it.
 */
export function savedVisualDocument(
  title: string,
  code: string,
  themeCss: string,
) {
  const escaped = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

  return visualPage(
    [
      `<title>${escaped}</title>`,
      `<style>${themeCss} :root { background: var(--background); }</style>`,
    ],
    code,
  );
}
