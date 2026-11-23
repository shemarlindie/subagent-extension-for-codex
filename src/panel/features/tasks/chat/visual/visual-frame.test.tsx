// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
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

test("the frame runs scripts alone, takes its own window's height, and opens links only after a click", () => {
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

  const link = { type: "visual-link", href: "https://x.dev/" };
  const activation = { isActive: false };
  vi.stubGlobal("navigator", { ...navigator, userActivation: activation });

  post(frame?.contentWindow, link);
  activation.isActive = true;
  post(frame?.contentWindow, { ...link, href: "javascript:alert(1)" });
  expect(openLink).not.toHaveBeenCalled();

  post(frame?.contentWindow, link);
  expect(openLink).toHaveBeenCalledWith("https://x.dev/");
  vi.unstubAllGlobals();
});
