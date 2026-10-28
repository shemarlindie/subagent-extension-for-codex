// @vitest-environment jsdom
import { expect, onTestFinished, test, vi } from "vitest";

import type { ChatItem } from "../../../../shared/tasks/conversation/chat";
import { setup } from "./chat-panel-test-harness";

function message(id: string, eventId: number): ChatItem {
  return {
    kind: "message",
    id,
    event_id: eventId,
    message: {
      id,
      event_id: eventId,
      timestamp: "2026-10-26T12:00:00Z",
      turn: eventId,
      from: "parent",
      kind: "message",
      text: `Review request ${eventId}`,
    },
  };
}

function captureEntrances() {
  const entrances: { element: HTMLElement; frames: Keyframe[] }[] = [];

  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, frames: Keyframe[]) {
      if (frames.some((frame) => frame.height)) {
        entrances.push({ element: this, frames });
      }

      return { cancel() {}, playState: "running" };
    },
  });

  const height = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(120);

  vi.stubGlobal("matchMedia", () => ({ matches: false }));

  onTestFinished(() => {
    height.mockRestore();
    vi.unstubAllGlobals();

    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, "animate", descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  return (id: string) =>
    entrances.filter(({ element }) => element.dataset.message === id);
}

test("new messages ease into existing history without replaying loaded history", () => {
  const entrances = captureEntrances();
  const initial = message("initial", 1);
  const { view, updateChat, updateTask } = setup({}, [], [initial]);

  expect(entrances("initial")).toHaveLength(0);
  updateChat([initial, message("arrival", 2)]);
  expect(entrances("arrival")).toHaveLength(1);

  expect(entrances("arrival")[0]!.element).toBe(
    view.container.querySelector('[data-message="arrival"]'),
  );

  expect(entrances("arrival")[0]!.frames.map((frame) => frame.height)).toEqual([
    "0px",
    "120px",
  ]);

  updateTask({ runtime_ms: 61_000 });
  expect(entrances("arrival")).toHaveLength(1);
  expect(entrances("initial")).toHaveLength(0);
});
