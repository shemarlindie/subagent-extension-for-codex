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
- Keep explanations in your reply, and put tables there as Markdown. The visual holds the essential picture, plus a short heading or labels when they help, since the panel doesn't show the visual's title.
- Split a big subject into several smaller visuals, with a sentence of reply text between them. Promise only the visuals you show.

## Look
- Flat surfaces with no gradients, shadows, blur, glow or decorative textures.
- Leave the root background transparent so the panel shows through.
- Put cards and screens on var(--surface) with var(--radius) corners and 1px var(--border) lines. Use rounded corners only on boxes with borders on all sides.
- Default to the quieter option. Too cluttered is the most common problem.

## Color
- Use only theme variables for text, lines and fills. Never hard-code grays, black or white, since they disappear in one of the themes. Check every text against both a near-black and a white background.
- Color carries meaning, never sequence. Give everything of one type the same color, and use 2 or 3 colors per visual. Keep neutral and structural parts in var(--surface), var(--border) and var(--muted).
- Use role colors for meaning: var(--accent) for the main series, emphasis and links, and var(--success), var(--warning) and var(--danger) for good, caution and bad.
- Use var(--series-1) to var(--series-8), in order, to tell categories apart. Past 8, fold the rest into an "Other" group.
- Make tints with color-mix(in srgb, var(--accent) 15%, transparent), using any role or series color.
- Role and series colors are for marks, icons, swatches and large text. Keep small text in var(--text) or var(--muted), including text on tints. A short badge label can use its tint's role color.
- Never rely on color alone. Pair it with a label, icon, shape or dash pattern, and add a one-line legend when colors encode meaning.

## Type
- Text inherits the panel's font and size. Use smaller sizes for secondary labels, never under 11px.
- Use two weights, 400 and 500. Never 600 or 700, which look heavy beside the panel. Bold only headings and labels, never words mid-sentence.
- Sentence case everywhere, including SVG labels and headings. Never Title Case or ALL CAPS.
- Use var(--font-mono) for code, paths and IDs.
- Round every number you show to the precision the reader needs. Format JavaScript results with Math.round, toFixed or Intl.NumberFormat, since float math leaks values like 0.30000000000000004. Put a minus sign before a currency symbol, as in -$5M.

## Layout
- Layouts must work from 320px wide. Prefer flexible grids, such as repeat(auto-fit, minmax(160px, 1fr)), and max-width to fixed widths. Use minmax(0, 1fr) where long content could push a column wider.
- The frame grows with its content up to 1,600px tall and then scrolls. Don't use vh units, viewport-height layouts, position: fixed or nested scroll areas, since they size against the frame itself.
- Space with rem between sections and px inside components, such as 8, 12 and 16px.

## SVG
- Set the viewBox from the content. Find the right and bottom edges of every shape and text, then add about 20px. Use no negative coordinates.
- Text with text-anchor="end" extends left from x, and text never wraps. Check that long labels stay inside, and break lines with tspan and dy.
- Give paths used as lines fill="none", since SVG fills paths black by default.

## Access
- Give an SVG role="img" and an aria-label that sums up what it shows.
- Label every control, and give icon-only buttons an aria-label.
- Draw icons as small inline SVG, 16 to 20px, with stroke="currentColor", or use text. Never emoji. Mark decorative icons aria-hidden="true".`;

const KIND_SECTIONS: Record<VisualKind, string> = {
  chart: `## Charts
Draw charts as inline SVG.

Pick the form from the data:
- One current value, maybe with a change: a stat tile, not a one-bar chart. A few headline numbers: a row of stat tiles.
- Compare amounts: bars. A trend over time: a line, or an area for a single series. Part of a whole: a stacked bar. Before and after per item: a dumbbell.
- One series is the point: draw it in var(--accent) and the rest in var(--muted).
- More than about 7 categories that all matter: a Markdown table in your reply.

Draw it:
- Show one chart per visual, with a short heading above it. A single series needs no legend, since the heading names it.
- Use one y-axis. Two scales need two charts.
- Bars up to about 32px thick, with 4px rounded ends at the value and square at the baseline. Lines 2px with round joins and caps. Area fills at about 10% of the series color. Leave a 2px gap between touching marks, never a stroke around them.
- Keep axes recessive: a few ticks and labels in var(--muted) at 11 or 12px, 1px gridlines in var(--border) or none, and no vertical gridlines on a time axis.
- Label values or series directly at the marks for up to 4 series. Add a legend for more, with a small square swatch in the series color and the value beside each label.
- A color follows its category, never its rank, so filtering or sorting doesn't repaint it.
- A stat tile has a 12px label in var(--muted) above a 22 to 24px value at weight 500, on var(--fill) with var(--radius) corners and no border. Put 2 to 4 in a grid with 12px gaps.`,
  diagram: `## Diagrams
Pick the type from what the user wants. A flowchart shows steps and decisions in order. A structural diagram shows things inside other things, such as services in a network. For how something works, an illustrative drawing of the mechanism beats labeled boxes.

Budget:
- At most 4 or 5 boxes in a row and about 6 in a diagram. For more, draw an overview with the main flow, then one diagram per part.
- A box holds a title of a few words and an optional subtitle of at most 5 words.
- Keep to one flow direction, left to right or top to bottom.

Boxes:
- Before writing each box, size it from its longest label: about 8px per character for a 13px title at weight 500 and 7px for a 12px subtitle, plus 24px of padding on each side. For example, a 20-character subtitle is about 140px, so its box needs about 188px. Shorten the label or widen the box, never let text overflow.
- Leave at least 20px between boxes in a row, and about 40 to 60px where an arrow runs between them. Check the row's total width before placing it.
- Boxes of one kind share a height, such as 40px for one line and 56px for a title and subtitle.
- Round box corners with rx="4" to "8". Mark a category with a tint and its color as the border, and highlight the key node with var(--accent).
- Center text in its box with text-anchor="middle" and dominant-baseline="central", with y at the center of its line. Titles at the inherited size and weight 500, subtitles at 11 or 12px in var(--muted).
- For containment, draw containers as larger boxes with their label at the top left and 20px of padding inside. At most 3 levels.

Arrows:
- Draw connectors in var(--muted) at 1 to 1.5px, with an arrowhead marker defined once in defs, such as <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>.
- Stop lines at box edges, with a few pixels of gap before the arrowhead.
- An arrow never crosses a box or a label. Route around with an L-shaped path when the straight line would.
- Skip arrow labels when the source and target make the meaning clear. Otherwise put a short label in clear space beside the line, never on it, and check it overlaps no other line or label.
- Show a loop with one return arrow or a small "returns to start" note, never by placing steps around a ring. A cycle with detail per stage works better as an interactive stepper.`,
  mockup: `## Mockups
- Show a static screen with realistic labels and sample content.
- Set a small mockup, such as a phone screen, card or dialog, on a var(--fill) backdrop with 12px corners and padding. A full-width page such as a dashboard or settings screen needs no backdrop.
- Draw a dialog inside a normal-flow backdrop with a min-height and a dimmed color-mix(in srgb, var(--text) 40%, transparent) background, never position: fixed.
- Draw inputs, selects, toggles and tracks with var(--fill) and 1px var(--border) lines, var(--radius) corners and a height of about 32 to 36px.
- Default buttons are quiet: transparent with a 1px var(--border) line. Use at most one primary button per view, in var(--accent) with var(--background) text.
- Show people as an initials circle on an accent tint, with var(--accent) text.
- Use bordered rows for dense lists, not a card per row.
- Leave out working logic, since the mockup shows the layout.`,
  interactive: `## Interactive pages
- Write controls as real button, input and select elements, so they work from the keyboard.
- Keep state in script variables. The sandbox blocks localStorage, sessionStorage, cookies and IndexedDB.
- Start in a useful state, and update results in place as the user changes inputs. Show values beside their sliders, and set step on ranges so they emit round values.
- Check input before acting on it. If a field is empty or invalid, show a 12px error in var(--danger) beside it and stop. Clear the error when the user edits the field.
- Change existing elements' classes and text instead of rebuilding controls with innerHTML, which drops their event listeners.
- Set accent-color: var(--accent) on checkboxes, radios and ranges.
- Animate only transform and opacity, in loops under about 2 seconds, inside @media (prefers-reduced-motion: no-preference). Animation should show how the system behaves.
- There's no fullscreen. For an expand control, toggle a class that makes the content larger in the normal flow.
- For a cycle or sequence, build a stepper: one panel per stage, dots showing position, and Next wrapping from the last stage to the first.
- A canvas can't read CSS variables. Read them once with getComputedStyle(document.documentElement).getPropertyValue("--accent").`,
};

/** The shared rules, then a section for each requested kind. */
export const visualGuide = (kinds: readonly VisualKind[]) =>
  [
    SHARED_RULES,
    ...visualKinds
      .filter((k) => kinds.includes(k))
      .map((k) => KIND_SECTIONS[k]),
  ].join("\n\n");
