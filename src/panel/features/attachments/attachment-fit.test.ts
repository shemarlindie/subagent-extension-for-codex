import { expect, test } from "vitest";

import { fitAttachments } from "./attachment-fit";

// Labels widen with the hidden count.
const label = (hidden: number) => (hidden === 1 ? 50 : 60);

const fit = (available: number, chips: number[]) =>
  fitAttachments({ available, gap: 6, chips, label });

test("every chip shows when the row holds them, with no label", () => {
  expect(fit(312, [100, 100, 100])).toEqual({ shown: 3 });
});

test("chips fit in order before the label, sized for the hidden count", () => {
  // Two chips and "+1 more" need 100 + 6 + 100 + 6 + 50.
  expect(fit(262, [100, 100, 150])).toEqual({ shown: 2 });
  // One pixel short, one chip shows beside the wider "+2 more".
  expect(fit(261, [100, 100, 150])).toEqual({ shown: 1 });
});

test("the first chip truncates when nothing fits beside the label", () => {
  expect(fit(120, [100, 100])).toEqual({ shown: 1, firstMax: 64 });
});

test("a lone chip too wide for the row takes the whole row", () => {
  expect(fit(80, [100])).toEqual({ shown: 1, firstMax: 80 });
});
