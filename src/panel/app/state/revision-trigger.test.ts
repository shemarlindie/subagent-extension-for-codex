import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { RevisionTrigger } from "./revision-trigger";

function fixture(t: { onTestFinished(fn: () => void): void }) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  t.onTestFinished(() => vi.useRealTimers());
  const state = { hidden: false, busy: false, refreshes: 0, forwards: 0 };

  const trigger = new RevisionTrigger({
    closed: () => false,
    hidden: () => state.hidden,
    busy: () => state.busy,
    refresh: () => state.refreshes++,
    forwardParentMessage: () => state.forwards++,
  });

  t.onTestFinished(() => trigger.dispose());

  return { state, trigger };
}

test("a new revision refreshes once per burst, without starving under a steady stream", (t) => {
  const { state, trigger } = fixture(t);

  // The first revision counts as new; a repeat schedules nothing.
  trigger.report("boot:1");
  trigger.report("boot:1");
  vi.advanceTimersByTime(100);
  assert.equal(state.refreshes, 1);
  trigger.report("boot:1");
  vi.advanceTimersByTime(1000);
  assert.equal(state.refreshes, 1);

  // Changes every 50 ms still refresh every 100 ms.
  for (let n = 2; n < 12; n++) {
    trigger.report(`boot:${n}`);
    vi.advanceTimersByTime(50);
  }

  assert.equal(state.refreshes, 6);
});

test("a hidden or busy panel keeps the refresh pending until it resumes", (t) => {
  const { state, trigger } = fixture(t);

  state.hidden = true;
  trigger.report("boot:1");
  vi.advanceTimersByTime(100);
  assert.equal(state.refreshes, 0);
  // A hidden panel still delivers parent messages.
  assert.equal(state.forwards, 1);
  trigger.resume();
  assert.equal(state.refreshes, 0);

  state.hidden = false;
  state.busy = true;
  trigger.resume();
  assert.equal(state.refreshes, 0);

  state.busy = false;
  trigger.resume();
  assert.equal(state.refreshes, 1);

  // Nothing is pending once it ran.
  trigger.resume();
  assert.equal(state.refreshes, 1);
});
