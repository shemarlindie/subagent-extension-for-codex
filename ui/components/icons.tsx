import type { ReactNode, SVGProps } from "react";

interface IconDefinition {
  /** Tight bounds of the icon geometry before its stroke is applied. */
  bounds: readonly [left: number, top: number, right: number, bottom: number];
  /** Path data drawn with the icon's stroke. */
  path?: string;
  /** Extra shapes drawn before the path, such as filled dots. */
  shapes?: ReactNode;
  strokeWidth?: number;
}

// Keep artwork (including stroke bounds) inside this shared canvas.
const ICON_VIEW_BOX = "0 0 24 24";
const ICON_VIEW_SIZE = 24;
const DEFAULT_ICON_SIZE = 16;

/**
 * Catalog of every icon in the panel. Add new glyphs here and render them with
 * `<Icon name="…" />` instead of writing inline `<svg>` markup.
 */
export const ICONS = {
  plus: { bounds: [5, 5, 19, 19], path: "M12 5v14M5 12h14", strokeWidth: 2.5 },
  worker: {
    bounds: [2, 3, 22, 21],
    path: "M12 3v2M8 5h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4ZM2 10v4m20-4v4M9 10h.01M15 10h.01M9 14h6M8 20v1m8-1v1",
    strokeWidth: 1.8,
  },
  eye: {
    bounds: [2, 6, 22, 18],
    path: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    strokeWidth: 1.8,
  },
  code: {
    bounds: [4, 6, 20, 18],
    path: "m8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 12",
    strokeWidth: 1.8,
  },
  flask: {
    bounds: [4.5, 3, 19.5, 22],
    path: "M9 3h6m-5 0v7l-5.5 9.3A1.8 1.8 0 0 0 6 22h12a1.8 1.8 0 0 0 1.5-2.7L14 10V3M7 17h10",
    strokeWidth: 1.8,
  },
  "arrows-horizontal": {
    bounds: [4, 4, 20, 20],
    path: "M4 7h16m0 0-3-3m3 3-3 3M20 17H4m0 0 3-3m-3 3 3 3",
    strokeWidth: 1.8,
  },
  "shield-check": {
    bounds: [4, 2, 20, 22],
    path: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-10 2 2 4-4",
    strokeWidth: 1.8,
  },
  settings: {
    bounds: [2, 2, 22, 22],
    path: "M10 2h4l1 3 2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1-1 3h-4l-1-3-2-1-3 1-2-4 2-2v-2l-2-2 2-4 3 1 2-1zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    strokeWidth: 1.7,
  },
  expand: {
    bounds: [4, 4, 20, 20],
    path: "M9 9 4 4m0 3V4h3M15 9l5-5m-3 0h3v3M9 15l-5 5m0-3v3h3M15 15l5 5m-3 0h3v-3",
    strokeWidth: 1.8,
  },
  collapse: {
    bounds: [4, 4, 20, 20],
    path: "M4 4l5 5m-3 0h3V6M20 4l-5 5m3 0h-3V6M4 20l5-5m-3 0h3v3M20 20l-5-5m3 0h-3v3",
    strokeWidth: 1.8,
  },
  "more-horizontal": {
    bounds: [5, 12, 19, 12],
    path: "M5 12h.01M12 12h.01M19 12h.01",
    strokeWidth: 4,
  },
  // Two arcs with rounded arrowheads, fitted so the arrow tips stay unclipped.
  refresh: {
    bounds: [1.375, 2.12, 22.625, 21.88],
    path: "M2.55 9.18A9.82 9.82 0 0 1 20.9 7.85M16.703 7.261 20.9 7.85 22.625 3.978M21.45 14.82A9.82 9.82 0 0 1 3.1 16.15M7.297 16.739 3.1 16.15 1.375 20.022",
    strokeWidth: 2.75,
  },
  play: { bounds: [7, 4, 19, 20], path: "M7 4l12 8-12 8Z", strokeWidth: 3 },
  pause: { bounds: [8, 5, 16, 19], path: "M8 5v14M16 5v14", strokeWidth: 3 },
  check: { bounds: [5, 6, 19, 16], path: "M5 12l4 4L19 6", strokeWidth: 3 },
  close: {
    bounds: [6, 6, 18, 18],
    path: "M6 6l12 12M18 6L6 18",
    strokeWidth: 3,
  },
  minus: { bounds: [6, 12, 18, 12], path: "M6 12h12", strokeWidth: 3 },
  stop: { bounds: [6, 6, 18, 18], path: "M6 6h12v12H6Z", strokeWidth: 3 },
  clock: {
    bounds: [3, 3, 21, 21],
    shapes: <circle cx="12" cy="12" r="9" />,
    path: "M12 8v4l3 2",
    strokeWidth: 3,
  },
  // Hook arc, stem, then a zero-length segment for the dot.
  help: {
    bounds: [8, 5, 16.5, 20],
    path: "M8 9a4 4 0 1 1 6.5 3.1C13 13 12 13.5 12 15.5M12 20h.01",
    strokeWidth: 3,
  },
  search: {
    bounds: [5, 5, 20, 20],
    shapes: <circle cx="11" cy="11" r="6" />,
    path: "m20 20-4.5-4.5",
  },
  glasses: {
    bounds: [1, 6, 23, 18],
    shapes: (
      <>
        <rect x="2.5" y="6" width="8.5" height="12" rx="3" />
        <rect x="13" y="6" width="8.5" height="12" rx="3" />
      </>
    ),
    path: "M2.5 8 1 7.5M10.5 10.5c.5-1.2 2.5-1.2 3 0m8-2 1.5-.5",
    strokeWidth: 1.8,
  },
  "git-merge": {
    bounds: [3.75, 1.75, 20.25, 22.25],
    shapes: (
      <>
        <circle cx="6" cy="4" r="2.25" />
        <circle cx="6" cy="20" r="2.25" />
        <circle cx="18" cy="4" r="2.25" />
      </>
    ),
    path: "M6 6.25v11.5M18 6.25v2a7 7 0 0 1-7 7H6",
    strokeWidth: 1.8,
  },
  "diff-search": {
    bounds: [2.5, 2.5, 22.2, 21.5],
    shapes: (
      <>
        <rect x="2.5" y="2.5" width="12.5" height="19" rx="2" />
        <circle cx="16.5" cy="14.5" r="4.1" />
      </>
    ),
    path: "M5.5 7h7m-7 4v2m3-1h4m-7 4h3M19.4 17.4l2.8 2.8",
    strokeWidth: 1.8,
  },
  "clipboard-check": {
    bounds: [4, 2.5, 20, 21],
    shapes: <rect x="8.5" y="2.5" width="7" height="4" rx="1.5" />,
    path: "M8.5 4.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2.5M8 13l2.5 2.5 5-5M8 18h8",
    strokeWidth: 1.8,
  },
  pencil: {
    bounds: [4, 2, 20, 20],
    path: "M4 20h16M5 13l-1 4 4-1L19 5l-3-3Z M13 5l3 3",
  },
  circle: {
    bounds: [3, 3, 21, 21],
    shapes: <circle cx="12" cy="12" r="9" />,
    strokeWidth: 3,
  },
  dot: {
    bounds: [4, 4, 20, 20],
    shapes: (
      <>
        <circle className="row-status-glow" cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  "chevron-down": {
    bounds: [3, 8, 21, 17],
    path: "M3 8l9 9 9-9",
    strokeWidth: 3,
  },
  bug: {
    bounds: [3, 3, 21, 21],
    path: "m8 3 2 3m6-3-2 3M9 9h6M12 9v11M4 7l3 3m13-3-3 3M3 13h4m10 0h4M4 19l3-3m13 3-3-3",
    shapes: <rect x="7" y="6" width="10" height="14" rx="5" />,
    strokeWidth: 1.5,
  },
  "arrow-up": {
    bounds: [8, 8, 16, 20],
    path: "M8 12l4-4 4 4M12 8v12",
  },
} as const satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;

type SvgProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "name" | "viewBox" | "width" | "height" | "strokeWidth"
>;

export interface IconProps extends SvgProps {
  name: IconName;
  /** Overrides the catalog size with a square of this many px. */
  size?: number;
  /** Overrides the catalog stroke width. */
  strokeWidth?: number;
  /** Accessible name. Without one the icon is hidden from assistive tech. */
  label?: string;
}

export function Icon({ name, size, strokeWidth, label, ...rest }: IconProps) {
  const def: IconDefinition = ICONS[name];
  const effectiveStrokeWidth = strokeWidth ?? def.strokeWidth ?? 2;
  const [left, top, right, bottom] = def.bounds;
  const sourceWidth = right - left + effectiveStrokeWidth;
  const sourceHeight = bottom - top + effectiveStrokeWidth;
  const scale = ICON_VIEW_SIZE / Math.max(sourceWidth, sourceHeight);
  const translateX = ICON_VIEW_SIZE / 2 - ((left + right) / 2) * scale;
  const translateY = ICON_VIEW_SIZE / 2 - ((top + bottom) / 2) * scale;

  return (
    <svg
      viewBox={ICON_VIEW_BOX}
      width={size ?? DEFAULT_ICON_SIZE}
      height={size ?? DEFAULT_ICON_SIZE}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeWidth={effectiveStrokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {label && <title>{label}</title>}
      <g
        transform={`matrix(${scale} 0 0 ${scale} ${translateX} ${translateY})`}
      >
        {def.shapes}
        {def.path && <path d={def.path} />}
      </g>
    </svg>
  );
}
