import type { ReactNode, SVGProps } from "react";

interface IconDefinition {
  /** Path data drawn with the icon's stroke. */
  path?: string;
  /** Extra shapes drawn before the path, such as filled dots. */
  shapes?: ReactNode;
  /** Defaults to the full 24-unit grid. Cropped boxes trim empty space without rescaling. */
  viewBox?: string;
  /** Rendered size in px when the caller does not pass `size`. Defaults to the viewBox size. */
  width?: number;
  height?: number;
  strokeWidth?: number;
}

/**
 * Catalog of every icon in the panel. Add new glyphs here and render them with
 * `<Icon name="…" />` instead of writing inline `<svg>` markup.
 */
export const ICONS = {
  play: { path: "M7 4l12 8-12 8Z", strokeWidth: 3 },
  pause: { path: "M8 5v14M16 5v14", strokeWidth: 3 },
  check: { path: "M5 12l4 4L19 6", strokeWidth: 3 },
  close: { path: "M6 6l12 12M18 6L6 18", strokeWidth: 3 },
  stop: { path: "M6 6h12v12H6Z", strokeWidth: 3 },
  clock: { path: "M12 8v4l3 2", strokeWidth: 3 },
  // Hook arc, stem, then a zero-length segment for the dot.
  help: {
    path: "M8 9a4 4 0 1 1 6.5 3.1C13 13 12 13.5 12 15.5M12 20h.01",
    strokeWidth: 3,
  },
  search: {
    shapes: <circle cx="11" cy="11" r="6" />,
    path: "m20 20-4.5-4.5",
  },
  pencil: { path: "M4 20h16M5 15l-1 4 4-1L19 7l-3-3Z M13 7l3 3" },
  circle: { shapes: <circle cx="12" cy="12" r="9" />, strokeWidth: 3 },
  dot: {
    shapes: (
      <>
        <circle className="row-status-glow" cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  // Cropped stroke bounds retain the original 14px / 16-unit scale.
  "chevron-down": {
    path: "m4 6 4 4 4-4",
    viewBox: "3.25 5.25 9.5 5.5",
    width: 8.3125,
    height: 4.8125,
    strokeWidth: 1.5,
  },
  // Cropped to the artwork, keeping the original 15px / 24-unit scale.
  bug: {
    path: "m8 3 2 3m6-3-2 3M9 9h6M12 9v11M4 7l3 3m13-3-3 3M3 13h4m10 0h4M4 19l3-3m13 3-3-3",
    shapes: <rect x="7" y="6" width="10" height="14" rx="5" />,
    viewBox: "2.25 2.25 19.5 18.5",
    width: 12.1875,
    height: 11.5625,
    strokeWidth: 1.5,
  },
  // Cropped to the artwork, keeping the original 20px / 24-unit scale.
  "arrow-up": {
    path: "m6 12 6-6 6 6M12 6v12",
    viewBox: "5 5 14 14",
    width: 20 * (14 / 24),
    height: 20 * (14 / 24),
  },
} as const satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;

type SvgProps = Omit<
  SVGProps<SVGSVGElement>,
  "name" | "viewBox" | "width" | "height" | "strokeWidth"
>;

export interface IconProps extends SvgProps {
  name: IconName;
  /** Overrides the catalog size with a square of this many px. */
  size?: number;
  /** Overrides the catalog stroke width. */
  strokeWidth?: number;
  /** Accessible name. Without one the icon is hidden from assistive tech. */
  label?: string;
  /**
   * Pads the shorter side of a cropped icon to a square, centered on the
   * artwork and without scaling it, so rotating the icon keeps a stable
   * layout footprint.
   */
  square?: boolean;
}

/** Pads a cropped viewBox and its rendered size out to a square. */
function squareGeometry(def: IconDefinition) {
  const [x, y, w, h] = (def.viewBox ?? "0 0 24 24").split(" ").map(Number);
  const side = Math.max(w, h);
  return {
    viewBox: `${x - (side - w) / 2} ${y - (side - h) / 2} ${side} ${side}`,
    width: Math.max(def.width ?? w, def.height ?? h),
  };
}

export function Icon({
  name,
  size,
  strokeWidth,
  label,
  square = false,
  children,
  ...rest
}: IconProps) {
  const def: IconDefinition = ICONS[name];
  const squared = square ? squareGeometry(def) : undefined;
  return (
    <svg
      viewBox={squared?.viewBox ?? def.viewBox ?? "0 0 24 24"}
      width={size ?? squared?.width ?? def.width}
      height={size ?? squared?.width ?? def.height}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? def.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {label && <title>{label}</title>}
      {def.shapes}
      {def.path && <path d={def.path} />}
      {children}
    </svg>
  );
}
