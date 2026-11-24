/** The kinds of visual the guide has a section for. */
export const visualKinds = [
  "chart",
  "diagram",
  "mockup",
  "interactive",
] as const;

type VisualKind = (typeof visualKinds)[number];

/** Rules for every visual. show_visual's description holds the frame contract. */
const SHARED_RULES = `# Visual style

Visuals should look native in the user's panel: flat, themed, readable in light and dark themes, and sized for the frame.

## Purpose
- Keep explanations in your reply. The visual holds the picture, plus a short heading or labels when they help, since the panel doesn't show the visual's title.

## Look
- Flat surfaces with no gradients, shadows, blur or glow.
- Leave the root background transparent so the panel shows through.
- Put cards and screens on var(--surface) with var(--radius) corners and 1px var(--border) lines.

## Color
- Use only the theme variables for text, lines and fills. Never hard-code grays, black or white.
- Use role colors for meaning: var(--accent) for the main series or emphasis, and var(--success), var(--warning) and var(--danger) for good, caution and bad.
- Make tints with color-mix(in srgb, var(--accent) 15%, transparent).
- Use role colors for marks, icons and large text. Keep small text in var(--text) or var(--muted), so it stays readable in both themes.

## Type
- Text inherits the panel's font and size. Set smaller sizes only for secondary labels, never under 11px.
- Use var(--font-mono) for code, paths and IDs.
- Use weights 400 and 500 only, sentence case, and numbers rounded to what the reader needs.

## Layout
- Layouts must work from 320px wide. Prefer flexible grids and max-width to fixed widths.
- The frame grows with its content up to 1,600px tall and then scrolls. Don't use vh units, viewport-height layouts or position: fixed, since they size against the frame itself.

## Access
- Give an SVG role="img" and an aria-label that sums up what it shows.
- Label every control.
- Draw icons with inline SVG or text, never emoji.`;

const KIND_SECTIONS: Record<VisualKind, string> = {
  chart: `## Charts
- Show one chart per visual, with a short heading above it.
- Keep axes light: a few ticks in var(--muted), and var(--border) gridlines or none.
- Label values or series directly at the marks where they fit.
- Draw the main series in var(--accent). For more series than the role colors cover, use mid-tone hues that read on both themes, such as #3b82f6, #14b8a6, #f59e0b, #a855f7 and #ec4899, with direct labels or a legend.`,
  diagram: `## Diagrams
- Draw boxes on var(--surface) with 1px var(--border) lines and var(--radius) corners.
- Draw arrows and connectors in var(--muted), with arrowhead markers.
- Keep labels to a few words per box, and put details in your reply. Place edge labels clear of lines and other labels.
- Keep to one flow direction, left to right or top to bottom. Highlight the key path or node with var(--accent).`,
  mockup: `## Mockups
- Show a static screen with realistic labels and sample content.
- Draw inputs, toggles and tracks with var(--fill) and 1px var(--border) lines. var(--fill) is a translucent fill that shows on var(--surface).
- Draw primary buttons in var(--accent) with var(--background) text.
- Leave out working logic, since the mockup shows the layout.`,
  interactive: `## Interactive pages
- Use inline scripts with labeled controls, such as buttons, sliders and selects.
- Keep state in script variables. The sandbox blocks localStorage, sessionStorage, cookies and IndexedDB.
- Start in a useful state, and update results in place as the user changes inputs.
- Set accent-color: var(--accent) on checkboxes, radios and ranges.`,
};

/** The shared rules, then a section for each requested kind. */
export const visualGuide = (kinds: readonly VisualKind[]) =>
  [
    SHARED_RULES,
    ...visualKinds
      .filter((k) => kinds.includes(k))
      .map((k) => KIND_SECTIONS[k]),
  ].join("\n\n");
