/** Measured widths for laying out a request's attachment row, in px. */
export type FitWidths = {
  /** The row's width. */
  available: number;
  gap: number;
  /** Each chip's natural width, in order. */
  chips: number[];
  /** The overflow label's width for this many hidden chips. */
  label: (hidden: number) => number;
};

/**
 * How much of the row shows: the first `shown` chips, then the overflow label
 * when some are hidden. `firstMax` truncates the first chip when nothing else
 * fits beside the label.
 */
export type AttachmentFit = {
  shown: number;
  firstMax?: number;
};

/** The overflow label, such as "+3 more". */
export const moreLabel = (hidden: number) => `+${hidden} more`;

/**
 * Fits chips in order on one line, then the label for the rest. When even the
 * first chip doesn't fit beside the label, it truncates to make room, or, as
 * the only chip, to the row.
 */
export function fitAttachments({
  available,
  gap,
  chips,
  label,
}: FitWidths): AttachmentFit {
  const count = chips.length;
  const ends: number[] = [];

  for (const [index, width] of chips.entries()) {
    ends.push((ends[index - 1] ?? -gap) + gap + width);
  }

  if (!count || ends[count - 1]! <= available) return { shown: count };
  // A lone chip has nothing to hide, so it takes the row.
  if (count === 1) return { shown: 1, firstMax: available };

  for (let shown = count - 1; shown >= 1; shown--) {
    if (ends[shown - 1]! + gap + label(count - shown) <= available) {
      return { shown };
    }
  }

  return {
    shown: 1,
    firstMax: Math.max(0, available - gap - label(count - 1)),
  };
}
