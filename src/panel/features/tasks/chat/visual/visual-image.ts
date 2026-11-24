export type Size = { width: number; height: number };

/** A visual's SVG, ready to draw as a PNG in any theme. */
export type VisualImage = {
  /** Standalone SVG markup without the theme. */
  svg: string;
  /** The size the PNG draws at, before scaling. */
  size: Size;
};

/** The PNG's pixels per SVG unit, for sharp text on high density screens. */
const PNG_SCALE = 2;

/** A large SVG draws smaller, so its canvas stays within browser limits. */
const MAX_PNG_PIXELS = 4096 * 4096;
const MAX_PNG_SIDE = 16384;

/**
 * The visual's `svg` element when the code is that element alone. The parser
 * moves leading styles and similar tags into the head, and a whole document's
 * `html` and `body` attributes onto its own, so either means more than the
 * element.
 */
function loneSvg(code: string) {
  const { documentElement, head, body } = new DOMParser().parseFromString(
    code,
    "text/html",
  );

  const [first] = body.children;

  const others = [...body.childNodes].filter(
    (node) =>
      node !== first &&
      (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()),
  );

  return documentElement.attributes.length === 0 &&
    body.attributes.length === 0 &&
    head.childNodes.length === 0 &&
    others.length === 0 &&
    first?.localName === "svg"
    ? first
    : undefined;
}

/**
 * Removes comments, which XML rejects when they hold `--`. Styles can't match
 * a comment, so the picture stays the same.
 */
function removeComments(svg: Element) {
  const walker = svg.ownerDocument.createTreeWalker(
    svg,
    NodeFilter.SHOW_COMMENT,
  );

  const comments: Comment[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as Comment);
  for (const comment of comments) comment.remove();
}

/**
 * The size the browser draws the SVG at: its unitless or pixel width and
 * height, with a missing side taken from the viewBox's shape, or else the
 * viewBox itself. Percentages and defaults count as missing.
 */
function svgSize(root: SVGSVGElement): Size | undefined {
  const drawable = (side: number) => Number.isFinite(side) && side > 0;

  const pixels = (name: "width" | "height") => {
    // A missing attribute is a missing side. This also keeps jsdom, which has
    // no SVG lengths, from reading one.
    if (!root.hasAttribute(name)) return NaN;
    const { baseVal } = root[name];

    return baseVal.unitType === SVGLength.SVG_LENGTHTYPE_NUMBER ||
      baseVal.unitType === SVGLength.SVG_LENGTHTYPE_PX
      ? baseVal.value
      : NaN;
  };

  // Firefox has no viewBox value when the attribute is missing.
  const box = root.viewBox.baseVal as DOMRect | null;
  const shape = box && drawable(box.width) && drawable(box.height) && box;
  let width = pixels("width");
  let height = pixels("height");

  if (shape && !drawable(width)) {
    width = drawable(height)
      ? (height * shape.width) / shape.height
      : shape.width;
  }

  if (shape && !drawable(height)) {
    height = (width * shape.height) / shape.width;
  }

  return drawable(width) && drawable(height) ? { width, height } : undefined;
}

/**
 * The visual as an SVG to draw a PNG from, or nothing when the code isn't one
 * `svg` element with a size. The browser draws an SVG image without running
 * scripts or loading anything, so the code needs no sanitizing. The parsing
 * happens in documents outside the panel's.
 */
export function prepareVisualImage(code: string): VisualImage | undefined {
  const svg = loneSvg(code);
  if (!svg) return undefined;
  removeComments(svg);

  // The serializer adds the `xmlns` that inline SVG often leaves out.
  const text = new XMLSerializer().serializeToString(svg);
  const file = new DOMParser().parseFromString(text, "image/svg+xml");

  // HTML allows characters and names that XML rejects.
  if (
    file.querySelector("parsererror") ||
    !(file.documentElement instanceof SVGSVGElement)
  ) {
    return undefined;
  }

  const size = svgSize(file.documentElement);

  return size && { svg: text, size };
}

/**
 * Twice the SVG's size, or smaller when that exceeds the limits. A side below
 * one pixel grows to one, and the side limit keeps the area within its limit.
 */
export function pngSize({ width, height }: Size): Size {
  const scale = Math.min(
    PNG_SCALE,
    Math.sqrt(MAX_PNG_PIXELS / (width * height)),
    MAX_PNG_SIDE / width,
    MAX_PNG_SIDE / height,
  );

  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
