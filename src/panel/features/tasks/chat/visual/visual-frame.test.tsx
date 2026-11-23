// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { Controller } from "../../../../app/state/controller";
import { ControllerContext } from "../../../../app/state/controller-context";
import { VisualFrame } from "./visual-frame";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

afterEach(cleanup);

test("the frame runs scripts alone, takes its own window's height, and shows the links it asks for as the panel's own", () => {
  const openLink = vi.fn(async () => {});

  const controller = {
    transport: { openLink },
    run: (next: () => Promise<unknown>) => void next(),
  } as unknown as Controller;

  const { container } = render(
    <ControllerContext.Provider value={controller}>
      <VisualFrame title="Signups" code="<svg></svg>" />
      <iframe title="Other" />
    </ControllerContext.Provider>,
  );

  const [frame, other] = container.querySelectorAll("iframe");
  expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");

  const post = (source: Window | null | undefined, data: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source, data }));
    });

  post(other?.contentWindow, { type: "visual-height", height: 400 });
  expect(frame?.style.height).toBe("150px");
  post(frame?.contentWindow, { type: "visual-height", height: 400 });
  expect(frame?.style.height).toBe("400px");

  post(frame?.contentWindow, { type: "visual-link", href: "javascript:x" });
  expect(screen.queryByRole("link")).toBeNull();

  // The frame's request opens nothing until the user clicks the destination.
  post(frame?.contentWindow, { type: "visual-link", href: "https://x.dev/" });
  expect(openLink).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "https://x.dev/" }));
  expect(openLink).toHaveBeenCalledWith("https://x.dev/");
});
