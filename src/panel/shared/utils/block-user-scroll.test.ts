// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import { blockUserScroll } from "./block-user-scroll";

afterEach(() => document.body.replaceChildren());

function touchMove(touches: number) {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: { length: touches } });

  return event;
}

test("blocks a loading region from scrolling but keeps pinch zoom available", () => {
  const region = document.createElement("div");
  document.body.append(region);
  const release = blockUserScroll(region);

  const oneFinger = touchMove(1),
    pinch = touchMove(2);

  region.dispatchEvent(oneFinger);
  region.dispatchEvent(pinch);

  assert.equal(oneFinger.defaultPrevented, true);
  assert.equal(pinch.defaultPrevented, false);

  release();
  const afterRelease = touchMove(1);
  region.dispatchEvent(afterRelease);
  assert.equal(afterRelease.defaultPrevented, false);
});
