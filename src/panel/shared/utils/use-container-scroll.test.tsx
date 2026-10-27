// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type KeyboardEvent, useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { useContainerScroll } from "./use-container-scroll";

afterEach(cleanup);

type SurfaceProps = { away: () => void };

function Surface({ away }: SurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  useContainerScroll(ref, () => {}, away);

  const handleKey = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === "Home") event.preventDefault();
  };

  return (
    <div ref={ref} role="region" style={{ overflowY: "auto" }}>
      <a href="#message" onKeyDown={handleKey}>
        Message link
      </a>
      <textarea aria-label="Answer" />
      <div data-testid="nested" style={{ overflowY: "auto" }}>
        Nested content
      </div>
    </div>
  );
}

test("reading keys reach the timeline from links without intercepting edits or handled keys", () => {
  const away = vi.fn();
  const view = render(<Surface away={away} />);
  fireEvent.keyDown(view.getByRole("link"), { key: "PageUp" });
  expect(away).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(view.getByRole("textbox"), { key: "ArrowUp" });
  fireEvent.keyDown(view.getByRole("link"), { key: "Home" });
  expect(away).toHaveBeenCalledTimes(1);
});

test("nested scrolling releases the timeline only when the gesture can reach it", () => {
  const away = vi.fn();
  const view = render(<Surface away={away} />);
  const nested = view.getByTestId("nested");
  nested.scrollTop = 40;
  fireEvent.wheel(nested, { deltaY: -20 });
  expect(away).not.toHaveBeenCalled();

  nested.scrollTop = 0;
  fireEvent.wheel(nested, { deltaY: -20 });
  expect(away).toHaveBeenCalledTimes(1);

  nested.style.overscrollBehaviorY = "contain";
  fireEvent.wheel(nested, { deltaY: -20 });
  expect(away).toHaveBeenCalledTimes(1);
});
