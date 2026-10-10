/// <reference types="vite/client" />

import type { SVGProps } from "react";

interface IconDefinition {
  artwork: string;
  strokeWidth: number;
}

// Keep the typed icon names aligned with the SVG filenames under assets/icons.
const ICON_NAMES = [
  "plus",
  "worker",
  "eye",
  "code",
  "flask",
  "arrows-horizontal",
  "shield-check",
  "settings",
  "expand",
  "collapse",
  "more-horizontal",
  "more-circle",
  "refresh",
  "play",
  "pause",
  "check",
  "close",
  "minus",
  "stop",
  "clock",
  "help",
  "search",
  "glasses",
  "git-merge",
  "diff-search",
  "clipboard-check",
  "task-details",
  "task-card",
  "inspector-panel",
  "handoff",
  "pencil",
  "pencil-simple",
  "circle",
  "dot",
  "chevron-down",
  "triangle-down",
  "bug",
  "copy",
  "enter",
  "reply",
  "stop-solid",
  // The task list resizer draws its own narrower grip inline.
  "grip-vertical",
  "grip-vertical-double",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const iconSources = import.meta.glob("../../../../../assets/icons/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

// The wrapper owns sizing and theming; each file supplies artwork and its default stroke width.
function parseIcon(source: string): IconDefinition {
  const openingTagEnd = source.indexOf(">");
  const closingTagStart = source.lastIndexOf("</svg>");
  const strokeWidth = source.match(/\bstroke-width="([^"]+)"/)?.[1];

  if (
    openingTagEnd < 0 ||
    closingTagStart <= openingTagEnd ||
    strokeWidth === undefined
  )
    throw new Error("Invalid SVG icon asset");

  return {
    artwork: source.slice(openingTagEnd + 1, closingTagStart).trim(),
    strokeWidth: Number(strokeWidth),
  };
}

type IconCatalog = { [Name in IconName]: IconDefinition };

export const ICONS = Object.fromEntries(
  ICON_NAMES.map((name) => {
    const source = iconSources["../../../../../assets/icons/" + name + ".svg"];

    if (source === undefined)
      throw new Error("Missing SVG icon asset: " + name);

    return [name, parseIcon(source)];
  }),
) as IconCatalog;

type SvgProps = Omit<
  SVGProps<SVGSVGElement>,
  | "children"
  | "dangerouslySetInnerHTML"
  | "name"
  | "viewBox"
  | "width"
  | "height"
  | "strokeWidth"
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

function escapeXmlText(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function Icon({ name, size, strokeWidth, label, ...rest }: IconProps) {
  const def: IconDefinition = ICONS[name];

  const artwork = label
    ? "<title>" + escapeXmlText(label) + "</title>" + def.artwork
    : def.artwork;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? 16}
      height={size ?? 16}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? def.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: artwork }}
      {...rest}
    />
  );
}
