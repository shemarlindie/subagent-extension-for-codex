import {
  VISUAL_SERIES_COUNT,
  type VisualToken,
} from "../../../../../core/shared/tasks/visual";

/**
 * What a visual's frame tells the panel. `width` is a lone element's width
 * when it draws narrower than the frame, and otherwise 0.
 */
type VisualFrameMessage =
  | { type: "visual-size"; height: number; width: number }
  | { type: "visual-link"; href: string };

/** A frame message, from data a visual's own scripts can also post. */
export function frameMessage(data: unknown): VisualFrameMessage | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { type, height, width, href } = data as Record<string, unknown>;

  if (type === "visual-size" && typeof height === "number") {
    if (!Number.isFinite(height)) return undefined;
    const narrower = typeof width === "number" && Number.isFinite(width);

    return { type, height, width: narrower ? Math.max(width, 0) : 0 };
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
 *
 * A visual that's one element, such as an SVG or a wrapper with a max width,
 * beside any style and script elements, also reports its width while it draws
 * narrower than the frame, so the panel can fit the visual's card to it. The
 * element centers unless it sets its own margins, so it doesn't move when the
 * card fits. Overflowing content counts toward the width, so the card doesn't
 * clip it.
 */
const FRAME_SCRIPT = `(() => {
  const post = (message) => parent.postMessage(message, "*");
  const root = document.documentElement;
  const loneElement = () => {
    const shown = [...(document.body?.children ?? [])].filter(
      (element) => !["style", "script"].includes(element.localName),
    );
    return shown.length === 1 ? shown[0] : undefined;
  };
  let reported;
  let centered;
  const report = () => {
    const height = Math.ceil(
      Math.max(root.getBoundingClientRect().height, document.body?.scrollHeight ?? 0),
    );
    const lone = loneElement();
    // Setting the style again would report again, so it's set once.
    if (lone && lone !== centered) {
      centered = lone;
      const { marginLeft, marginRight } = getComputedStyle(lone);
      if (marginLeft === "0px" && marginRight === "0px") lone.style.marginInline = "auto";
    }
    const drawn = Math.ceil(
      Math.max(lone?.getBoundingClientRect().width ?? 0, lone?.scrollWidth ?? 0),
    );
    const width = drawn < root.clientWidth ? drawn : 0;
    if (height === reported?.height && width === reported?.width) return;
    reported = { height, width };
    root.style.overflow = height > ${MAX_VISUAL_HEIGHT} ? "auto" : "hidden";
    post({ type: "visual-size", height, width });
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

/**
 * The panel token behind each visual token, plus `--font-sans` for the base
 * style. `--success` has its own colors.
 */
const THEME_TOKENS = {
  "--text": "--text",
  "--muted": "--muted",
  "--background": "--bg",
  "--surface": "--surface",
  "--border": "--line",
  "--accent": "--accent",
  "--warning": "--warn",
  "--danger": "--danger",
  "--fill": "--hover",
  "--radius": "--radius",
  "--font-sans": "--font-sans",
  "--font-mono": "--font-mono",
} satisfies Record<Exclude<VisualToken, "--success"> | "--font-sans", string>;

/** Claude Code's token names, which workers also use, mapped onto ours. */
const TOKEN_ALIASES = [
  "--text-primary: var(--text);",
  "--text-secondary: var(--muted);",
  "--text-muted: var(--muted);",
  "--surface-0: var(--surface);",
  "--surface-1: var(--background);",
  "--surface-2: var(--background);",
  "--bg-neutral: var(--fill);",
  "--border-strong: color-mix(in srgb, var(--text) 25%, transparent);",
  ...["accent", "success", "warning", "danger"].map((role) => {
    // The soft success green is too light for small text, so its text color
    // mixes in the text color.
    const text =
      role === "success"
        ? "color-mix(in srgb, var(--success) 70%, var(--text))"
        : `var(--${role})`;

    return `--text-${role}: ${text}; --border-${role}: var(--${role}); --bg-${role}: color-mix(in srgb, var(--${role}) 15%, transparent);`;
  }),
].join(" ");

/** Light and dark pairs of categorical colors, for marks rather than text. */
const SERIES_COLORS = [
  ["#2a78d6", "#3987e5"],
  ["#eb6834", "#d95926"],
  ["#1baf7a", "#199e70"],
  ["#eda100", "#c98500"],
  ["#e87ba4", "#d55181"],
  ["#008300", "#0ca30c"],
  ["#6250d6", "#9085e9"],
  ["#e34948", "#e66767"],
] as const satisfies readonly (readonly [light: string, dark: string])[] & {
  length: typeof VISUAL_SERIES_COUNT;
};

/** A softer green than the host's success color, which is harsh in visuals. */
const SUCCESS_COLOR: [light: string, dark: string] = ["#30a46c", "#3dd68c"];

/**
 * The panel's theme as CSS for a visual's root, with Chat's text size in
 * `--font-size`. The frame matches the panel's color scheme, or the browser
 * paints it an opaque default background.
 */
export function visualThemeCss(root: Element) {
  const style = getComputedStyle(root);
  const dark = style.colorScheme === "dark";

  const tokens = Object.entries(THEME_TOKENS).map(
    ([name, panel]) => `${name}: ${style.getPropertyValue(panel).trim()};`,
  );

  const series = SERIES_COLORS.map(
    (pair, i) => `--series-${i + 1}: ${pair[dark ? 1 : 0]};`,
  );

  return `:root { ${tokens.join(" ")} --success: ${SUCCESS_COLOR[dark ? 1 : 0]}; ${series.join(" ")} ${TOKEN_ALIASES} --font-size: ${style.fontSize}; color-scheme: ${style.colorScheme || "normal"}; }`;
}

/** The widest a top-level SVG without a pixel width draws. */
const MAX_UNSIZED_SVG_WIDTH = 720;

/** A top-level SVG without a pixel width. */
const UNSIZED_SVG = (at: string) =>
  `${at}:not([width]):not([height]), ${at}[width$="%"]`;

/**
 * A top-level SVG scales evenly, so extra width only enlarges it. It centers
 * and shrinks to fit, keeping its shape. One with a pixel width keeps it, and
 * one without stops at the cap.
 */
const BASE_STYLE = [
  ":root { color: var(--text); font-family: var(--font-sans); font-size: var(--font-size); line-height: 1.5; }",
  "body { margin: 0; position: relative; }",
  "body > svg { display: block; margin-inline: auto; max-width: 100%; }",
  "body > svg[width][height] { height: auto; }",
  `${UNSIZED_SVG("body > svg")} { max-width: min(100%, ${MAX_UNSIZED_SVG_WIDTH}px); }`,
].join(" ");

/**
 * Rules that stop each top-level SVG without a pixel width at its viewBox
 * width, below the cap, since its text is drawn at viewBox scale. CSS can't
 * read the viewBox, so each rule matches the attribute's text, which must be
 * plain numbers to quote as is.
 */
function viewBoxWidthStyle(code: string) {
  const { body } = new DOMParser().parseFromString(code, "text/html");
  const rules = new Set<string>();

  for (const svg of body.querySelectorAll(":scope > svg[viewBox]")) {
    const box = svg.getAttribute("viewBox") ?? "";
    if (!/^[\d\s.,eE+-]+$/.test(box)) continue;

    const width = Number(box.trim().split(/[\s,]+/)[2]);
    if (!(width > 0 && width < MAX_UNSIZED_SVG_WIDTH)) continue;

    rules.add(
      `${UNSIZED_SVG(`body > svg[viewBox="${box}"]`)} { max-width: min(100%, ${width}px); }`,
    );
  }

  return [...rules].join(" ");
}

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
    `<style>${BASE_STYLE} ${viewBoxWidthStyle(code)}</style>`,
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
