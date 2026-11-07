import { expect, test, vi } from "vitest";

import { animateRows, type RowPosition } from "./row-motion";

function row(top: number): RowPosition {
  const element = { animate: vi.fn(() => ({}) as Animation) };

  return {
    element: element as unknown as HTMLElement,
    top,
    bottom: top + 40,
  };
}

const view = { top: 0, bottom: 400 };

test("arrivals-only motion fades new rows in place and leaves moved rows still", () => {
  const previous = new Map([["kept", row(100)]]);

  const next = new Map([
    ["kept", row(60)],
    ["new", row(100)],
  ]);

  expect(animateRows(previous, next, view, true)).toHaveLength(1);
  expect(next.get("kept")!.element.animate).not.toHaveBeenCalled();

  // Fading opacity only keeps rows measurable while a stream re-renders.
  expect(next.get("new")!.element.animate).toHaveBeenCalledExactlyOnceWith(
    [{ opacity: 0 }, { opacity: 1 }],
    expect.any(Object),
  );

  // Without it, the moved row slides too.
  expect(animateRows(previous, next, view)).toHaveLength(2);
});
