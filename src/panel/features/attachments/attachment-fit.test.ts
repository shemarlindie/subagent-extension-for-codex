import { expect, test } from "vitest";

import { fitAttachments } from "./attachment-fit";

// Full labels widen for the plural.
function label(hidden: number, short: boolean) {
  if (short) return 40;

  return hidden === 1 ? 110 : 120;
}

const fit = (available: number, chips: number[]) =>
  fitAttachments({ available, gap: 6, chips, label });

test("every chip shows when the row holds them, with no label", () => {
  expect(fit(312, [100, 100, 100])).toEqual({ shown: 3 });
});

test("chips fit in order before the full label, sized for the hidden count", () => {
  // Two chips and "+ 1 more attachment" need 100 + 6 + 100 + 6 + 110.
  expect(fit(322, [100, 100, 150])).toEqual({ shown: 2 });
  // One pixel short, one chip shows beside the plural label.
  expect(fit(321, [100, 100, 150])).toEqual({ shown: 1 });
});

test("the short label comes before truncating, and the first chip truncates last", () => {
  expect(fit(150, [100, 100])).toEqual({ shown: 1, short: true });
  expect(fit(120, [100, 100])).toEqual({ shown: 1, short: true, firstMax: 74 });
});

test("a lone chip too wide for the row takes the whole row", () => {
  expect(fit(80, [100])).toEqual({ shown: 1, firstMax: 80 });
});
