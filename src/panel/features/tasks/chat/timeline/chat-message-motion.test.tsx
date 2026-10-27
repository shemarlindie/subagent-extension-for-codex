// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages";
import { ChatMessageView } from "./chat-message-view";

function streamingMotion() {
  onTestFinished(cleanup);
  const displayed = new Map<HTMLElement, number>();

  const animations: {
    element: HTMLElement;
    frames: Keyframe[];
    animation: {
      onfinish: (() => void) | null;
      cancel: ReturnType<typeof vi.fn>;
    };
  }[] = [];

  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, frames: Keyframe[]) {
      const animation = {
        onfinish: null,
        cancel: vi.fn(() => displayed.delete(this)),
      };

      displayed.set(this, parseFloat(String(frames[0]?.height)));
      animations.push({ element: this, frames, animation });

      return animation;
    },
  });

  const height = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return (
        displayed.get(this) ??
        Math.ceil((this.textContent?.length ?? 0) / 10) * 20
      );
    });

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

  return { animations, displayed };
}

const message = (text: string): ConversationMessage => ({
  id: "streamed-reply",
  event_id: 1,
  timestamp: "2026-10-26T12:00:00Z",
  turn: 1,
  from: "worker",
  kind: "message",
  text,
});

test("streamed text eases new lines into view while same-line deltas keep their height", () => {
  const { animations } = streamingMotion();

  const content = (text: string) => (
    <ChatMessageView message={message(text)} worker="Claude" streaming />
  );

  const view = render(content("First"));
  expect(animations).toHaveLength(0);

  view.rerender(content("First word"));
  expect(animations).toHaveLength(0);

  view.rerender(content("First words"));
  expect(animations).toHaveLength(1);

  expect(animations[0]!.element).toBe(
    view.container.querySelector(".chat-message"),
  );

  expect(animations[0]!.frames.map((frame) => frame.height)).toEqual([
    "20px",
    "40px",
  ]);
});

test("saving a streamed message continues from its displayed height without replaying its entrance", () => {
  const { animations, displayed } = streamingMotion();

  const view = render(
    <ChatMessageView
      message={message("First")}
      worker="Claude"
      streaming
      arriving
    />,
  );

  const article = view.container.querySelector(".chat-message");
  const arrival = animations[0]!;
  displayed.set(arrival.element, 10);

  view.rerender(<ChatMessageView message={message("First")} worker="Claude" />);

  expect(view.container.querySelector(".chat-message")).toBe(article);
  expect(animations).toHaveLength(2);
  expect(arrival.animation.cancel).toHaveBeenCalledOnce();

  expect(animations[1]!.frames.map((frame) => frame.height)).toEqual([
    "10px",
    "20px",
  ]);
});
