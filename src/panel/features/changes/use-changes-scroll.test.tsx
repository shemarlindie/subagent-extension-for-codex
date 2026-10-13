// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { onTestFinished, test } from "vitest";

import type { ChangesReading } from "./changes-reading";
import { useChangesScroll } from "./use-changes-scroll";

type HarnessProps = { reading: ChangesReading };

function Harness({ reading }: HarnessProps) {
  const { viewportRef } = useChangesScroll(reading, true);

  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <div ref={viewportRef}>
        <details data-changed-file="a.ts" />
      </div>
    </div>
  );
}

/** jsdom has no layout; give every element a scroll and client height. */
function layout(scrollHeight: number, clientHeight: number) {
  const proto = HTMLElement.prototype,
    saved = ["scrollHeight", "clientHeight"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const,
    );

  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });

  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });

  onTestFinished(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
    }
  });
}

test("the saved place is restored, and the restore's own scroll doesn't replace it", () => {
  onTestFinished(cleanup);
  layout(1000, 200);

  const position = { top: 120, anchor: { path: "gone.ts", top: 5 } },
    reading: ChangesReading = { position, open: new Map() },
    view = render(<Harness reading={reading} />),
    scroller = view.getByTestId("scroller");

  assert.equal(scroller.scrollTop, 120);

  fireEvent.scroll(scroller);
  assert.equal(reading.position, position);

  // The reader's scroll is saved.
  scroller.scrollTop = 40;
  fireEvent.scroll(scroller);
  assert.equal(reading.position?.top, 40);

  // Returning to the restored offset is the reader's too.
  scroller.scrollTop = 120;
  fireEvent.scroll(scroller);
  assert.equal(reading.position?.top, 120);
});

test("content that fits has nothing to restore", () => {
  onTestFinished(cleanup);
  layout(200, 200);

  const reading: ChangesReading = {
      position: { top: 120 },
      open: new Map(),
    },
    view = render(<Harness reading={reading} />);

  assert.equal(view.getByTestId("scroller").scrollTop, 0);
});
