import type { ReactNode, SVGProps } from "react";

interface IconDefinition {
  /** Path data drawn with the icon's stroke. */
  path?: string;
  /** Extra shapes drawn before the path, such as filled dots. */
  shapes?: ReactNode;
  /** Stroke width in the 24 x 24 drawing space. */
  strokeWidth: number;
}

// Every glyph is drawn to fill this canvas, stroke included.
const ICON_VIEW_BOX = "0 0 24 24";
const DEFAULT_ICON_SIZE = 16;

/**
 * Catalog of every icon in the panel. Draw new glyphs to fill the 24 x 24 box (stroke included), add them here and render them with
 * `<Icon name="…" />` instead of writing inline `<svg>` markup.
 */
export const ICONS = {
  plus: {
    path: "M12 1.818v20.364M1.818 12h20.364",
    strokeWidth: 3.636,
  },
  worker: {
    path: "M12 2.092v2.202M7.596 4.294h8.807a4.404 4.404 0 0 1 4.404 4.404v4.404a4.404 4.404 0 0 1-4.404 4.404H7.596a4.404 4.404 0 0 1-4.404-4.404V8.697a4.404 4.404 0 0 1 4.404-4.404ZM0.991 9.798v4.404m22.018-4.404v4.404M8.697 9.798h0.011M15.303 9.798h0.011M8.697 14.202h6.606M7.596 20.807v1.101m8.807-1.101v1.101",
    strokeWidth: 1.982,
  },
  eye: {
    path: "M0.991 12s3.853-6.606 11.009-6.606 11.009 6.606 11.009 6.606-3.853 6.606-11.009 6.606-11.009-6.606-11.009-6.606Zm11.009 3.303a3.303 3.303 0 1 0 0-6.606 3.303 3.303 0 0 0 0 6.606Z",
    strokeWidth: 1.982,
  },
  code: {
    path: "m6.607 6.607-5.393 5.393 5.393 5.393m10.787-10.787 5.393 5.393-5.393 5.393m-4.045-13.483-2.697 16.18",
    strokeWidth: 2.427,
  },
  flask: {
    path: "M8.538 1.038h6.923m-5.769 0v8.077l-6.346 10.731A2.077 2.077 0 0 0 5.077 22.962h13.846a2.077 2.077 0 0 0 1.731-3.115L14.308 9.115V1.038M6.231 17.192h11.538",
    strokeWidth: 2.077,
  },
  "arrows-horizontal": {
    path: "M1.213 5.258h21.573m0 0-4.045-4.045m4.045 4.045-4.045 4.045M22.787 18.742H1.213m0 0 4.045-4.045m-4.045 4.045 4.045 4.045",
    strokeWidth: 2.427,
  },
  "shield-check": {
    path: "M12 23.009s8.807-4.404 8.807-12.11V4.294l-8.807-3.303-8.807 3.303v6.606c0 7.706 8.807 12.11 8.807 12.11Zm-3.303-11.009 2.202 2.202 4.404-4.404",
    strokeWidth: 1.982,
  },
  settings: {
    path: "M9.788 0.94h4.424l1.106 3.318 2.212 1.106 3.318-1.106 2.212 4.424-2.212 2.212v2.212l2.212 2.212-2.212 4.424-3.318-1.106-2.212 1.106-1.106 3.318h-4.424l-1.106-3.318-2.212-1.106-3.318 1.106-2.212-4.424 2.212-2.212v-2.212l-2.212-2.212 2.212-4.424 3.318 1.106 2.212-1.106zM12 8.682a3.318 3.318 0 1 0 0 6.636 3.318 3.318 0 0 0 0-6.636Z",
    strokeWidth: 1.88,
  },
  expand: {
    path: "M7.955 7.955 1.213 1.213m0 4.045V1.213h4.045M16.045 7.955l6.742-6.742m-4.045 0h4.045v4.045M7.955 16.045l-6.742 6.742m0-4.045v4.045h4.045M16.045 16.045l6.742 6.742m-4.045 0h4.045v-4.045",
    strokeWidth: 2.427,
  },
  collapse: {
    path: "M1.213 1.213l6.742 6.742m-4.045 0h4.045V3.91M22.787 1.213l-6.742 6.742m4.045 0h-4.045V3.91M1.213 22.787l6.742-6.742m-4.045 0h4.045v4.045M22.787 22.787l-6.742-6.742m4.045 0h-4.045v4.045",
    strokeWidth: 2.427,
  },
  "more-horizontal": {
    path: "M2.667 12h0.013M12 12h0.013M21.333 12h0.013",
    strokeWidth: 5.333,
  },
  // Two arcs with rounded arrowheads, fitted so the arrow tips stay unclipped.
  refresh: {
    path: "M2.55 9.18A9.82 9.82 0 0 1 20.9 7.85M16.703 7.261 20.9 7.85 22.625 3.978M21.45 14.82A9.82 9.82 0 0 1 3.1 16.15M7.297 16.739 3.1 16.15 1.375 20.022",
    strokeWidth: 2.75,
  },
  play: {
    path: "M4.421 1.895l15.158 10.105-15.158 10.105Z",
    strokeWidth: 3.789,
  },
  pause: {
    path: "M6.353 2.118v19.765M17.647 2.118v19.765",
    strokeWidth: 4.235,
  },
  check: {
    path: "M2.118 13.412l5.647 5.647L21.882 4.941",
    strokeWidth: 4.235,
  },
  close: {
    path: "M2.4 2.4l19.2 19.2M21.6 2.4L2.4 21.6",
    strokeWidth: 4.8,
  },
  minus: {
    path: "M2.4 12h19.2",
    strokeWidth: 4.8,
  },
  stop: {
    path: "M2.4 2.4h19.2v19.2H2.4Z",
    strokeWidth: 4.2,
  },
  clock: {
    shapes: <circle cx="12" cy="12" r="10.286" />,
    path: "M12 7.429v4.571l3.429 2.286",
    strokeWidth: 3.429,
  },
  // Hook arc, stem, then a zero-length segment for the dot.
  help: {
    path: "M6.333 7.333a5.333 5.333 0 1 1 8.667 4.133C13 12.667 11.667 13.333 11.667 16M11.667 22h0.013",
    strokeWidth: 4,
  },
  search: {
    shapes: <circle cx="9.882" cy="9.882" r="8.471" />,
    path: "m22.588 22.588-6.353-6.353",
    strokeWidth: 2.824,
  },
  glasses: {
    shapes: (
      <>
        <rect x="2.42" y="5.95" width="8.571" height="12.101" rx="3.025" />
        <rect x="13.008" y="5.95" width="8.571" height="12.101" rx="3.025" />
      </>
    ),
    path: "M2.42 7.966 0.908 7.462M10.487 10.487c0.504-1.21 2.521-1.21 3.025 0m8.067-2.017 1.513-0.504",
    strokeWidth: 1.815,
  },
  "git-merge": {
    shapes: (
      <>
        <circle cx="5.543" cy="3.39" r="2.422" />
        <circle cx="5.543" cy="20.61" r="2.422" />
        <circle cx="18.457" cy="3.39" r="2.422" />
      </>
    ),
    path: "M5.543 5.812v12.377M18.457 5.812v2.152a7.534 7.534 0 0 1-7.534 7.534H5.543",
    strokeWidth: 1.937,
  },
  "diff-search": {
    shapes: (
      <>
        <rect x="1.005" y="1.395" width="13.953" height="21.209" rx="2.233" />
        <circle cx="16.633" cy="14.791" r="4.577" />
      </>
    ),
    path: "M4.353 6.419h7.814m-7.814 4.465v2.233m3.349-1.116h4.465m-7.814 4.465h3.349M19.87 18.028l3.126 3.126",
    strokeWidth: 2.009,
  },
  "clipboard-check": {
    shapes: (
      <rect x="7.862" y="1.064" width="8.276" height="4.729" rx="1.773" />
    ),
    path: "M7.862 3.429H4.906a2.365 2.365 0 0 0-2.365 2.365V20.571a2.365 2.365 0 0 0 2.365 2.365h14.187a2.365 2.365 0 0 0 2.365-2.365V5.793a2.365 2.365 0 0 0-2.365-2.365h-2.956M7.271 13.478l2.956 2.956 5.911-5.911M7.271 19.389h9.458",
    strokeWidth: 2.128,
  },
  "task-details": {
    path: "M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V9Zm0 0v4a2.5 2.5 0 0 0 2.5 2.5h3M8.5 15h7m-7 4h7",
    strokeWidth: 1.8,
  },
  "task-card": {
    shapes: (
      <>
        <rect x="3" y="3.5" width="18" height="17" rx="2" />
        <rect x="6.5" y="7" width="3.5" height="3.5" rx="0.5" />
      </>
    ),
    path: "M12.5 8.75h4.5M6.5 15h10.5",
    strokeWidth: 1.8,
  },
  "inspector-panel": {
    shapes: <rect x="2.5" y="3" width="19" height="18" rx="2" />,
    path: "M2.5 7.5h19M9 7.5V21M5 5.25h.01M7 5.25h.01m5 5.75h5.5m-5.5 3.5h5.5m-5.5 3.5h4",
    strokeWidth: 1.8,
  },
  handoff: {
    shapes: (
      <>
        <circle cx="4" cy="12" r="2.5" />
        <circle cx="20" cy="12" r="2.5" />
      </>
    ),
    path: "M7 12h10.5m-3-3 3 3-3 3",
    strokeWidth: 1.8,
  },
  pencil: {
    path: "M2.4 22.8h19.2M3.6 14.4l-1.2 4.8 4.8-1.2L20.4 4.8l-3.6-3.6ZM13.2 4.8l3.6 3.6",
    strokeWidth: 2.4,
  },
  circle: {
    shapes: <circle cx="12" cy="12" r="10.286" />,
    strokeWidth: 3.429,
  },
  dot: {
    shapes: (
      <>
        <circle className="row-status-glow" cx="12" cy="12" r="10.667" />
        <circle cx="12" cy="12" r="6.667" fill="currentColor" stroke="none" />
      </>
    ),
    strokeWidth: 2.667,
  },
  "chevron-down": {
    path: "M1.714 6.857l10.286 10.286 10.286-10.286",
    strokeWidth: 3.429,
  },
  bug: {
    shapes: (
      <rect x="5.846" y="4.615" width="12.308" height="17.231" rx="6.154" />
    ),
    path: "m7.077 0.923 2.462 3.692m7.385-3.692-2.462 3.692M8.308 8.308h7.385M12 8.308v13.538M2.154 5.846l3.692 3.692m16-3.692-3.692 3.692M0.923 13.231h4.923m12.308 0h4.923M2.154 20.615l3.692-3.692m16 3.692-3.692-3.692",
    strokeWidth: 1.846,
  },
  "arrow-up": {
    path: "M5.143 8.571l6.857-6.857 6.857 6.857M12 1.714v20.571",
    strokeWidth: 3.429,
  },
  copy: {
    path: "M9.6 7.2h10.8a2.4 2.4 0 0 1 2.4 2.4v10.8a2.4 2.4 0 0 1-2.4 2.4H9.6a2.4 2.4 0 0 1-2.4-2.4V9.6a2.4 2.4 0 0 1 2.4-2.4ZM3.6 16.8a2.4 2.4 0 0 1-2.4-2.4V3.6a2.4 2.4 0 0 1 2.4-2.4h10.8a2.4 2.4 0 0 1 2.4 2.4",
    strokeWidth: 2.4,
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
  const effectiveStrokeWidth = strokeWidth ?? def.strokeWidth;

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
      {def.shapes}
      {def.path && <path d={def.path} />}
    </svg>
  );
}
