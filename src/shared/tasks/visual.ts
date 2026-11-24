/**
 * The most characters a visual's code may have. Rendering handles far more,
 * but the code stays in the task's history and the worker's context.
 */
export const MAX_VISUAL_CODE = 200_000;

/** The id of a visual's Chat item and conversation message. */
export const visualId = (visual: number) => `visual_${visual}`;

/** What the conversation shows the parent in place of a visual's code. */
export const visualPlaceholder = (visual: number, title: string) =>
  `[Visual ${visual} shown in the panel: ${title}]`;

/**
 * The CSS variables a visual can use, which show_visual's description names
 * and the panel's theme sets.
 */
export const visualTokens = [
  "--text",
  "--muted",
  "--background",
  "--surface",
  "--border",
  "--accent",
  "--success",
  "--warning",
  "--danger",
  "--fill",
  "--radius",
  "--font-mono",
] as const;

export type VisualToken = (typeof visualTokens)[number];

/** How many categorical colors a visual gets, as `--series-1` and up. */
export const VISUAL_SERIES_COUNT = 8;
