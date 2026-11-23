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

  // The frame's request opens nothing until the user clicks the destination.
  post(frame?.contentWindow, { type: "visual-link", href: "https://x.dev/" });
  expect(openLink).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "https://x.dev/" }));
  expect(openLink).toHaveBeenCalledWith("https://x.dev/");
});

test("a theme change restyles the frame in place, and a new version drops the previous one's link", async () => {
  const { container, rerender } = render(
    <VisualFrame title="Signups" code="<svg>1</svg>" />,
  );

  const frame = container.querySelector("iframe");
  const first = frame?.getAttribute("srcdoc");
  const send = vi.spyOn(frame?.contentWindow as Window, "postMessage");

  await act(async () => {
    document.documentElement.style.setProperty("--accent", "red");
  });

  expect(frame?.getAttribute("srcdoc")).toBe(first);

  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ css: expect.stringContaining("--accent: red") }),
    "*",
  );

  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame?.contentWindow,
        data: { type: "visual-link", href: "https://x.dev/" },
      }),
    );
  });

  expect(screen.getByRole("link")).toBeTruthy();
  rerender(<VisualFrame title="Signups" code="<svg>2</svg>" />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(frame?.getAttribute("srcdoc")).toContain("<svg>2</svg>");
  document.documentElement.removeAttribute("style");
});
