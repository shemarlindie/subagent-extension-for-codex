// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { MOTION } from "../motion/motion-utils";
import { LoadingSkeleton, SkeletonShape } from "./loading-skeleton";
import { LOADING_SKELETON_CONFIG } from "./loading-skeleton-config";
import { LoadingSwap } from "./loading-swap";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function panel(loading: boolean) {
  return (
    <LoadingSwap
      loading={loading}
      skeleton={
        <LoadingSkeleton label="Loading records">
          <SkeletonShape />
        </LoadingSkeleton>
      }
    >
      <p>Loaded records</p>
    </LoadingSwap>
  );
}

function advanceSkeletonDelay() {
  act(() => {
    vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.delay);
  });
}

test("skips the skeleton when a request resolves before its delay", () => {
  vi.useFakeTimers();
  const view = render(panel(true));

  if (!LOADING_SKELETON_CONFIG.delay) {
    expect(view.getByRole("status", { name: "Loading records" })).toBeTruthy();

    return;
  }

  expect(view.queryByRole("status", { name: "Loading records" })).toBeNull();

  if (LOADING_SKELETON_CONFIG.delay > 1) {
    act(() => {
      vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.delay - 1);
    });

    expect(view.queryByRole("status", { name: "Loading records" })).toBeNull();
  }

  view.rerender(panel(false));
  advanceSkeletonDelay();

  expect(view.queryByRole("status", { name: "Loading records" })).toBeNull();
  expect(view.container.querySelector(".loading-swap-skeleton")).toBeNull();
  expect(view.getByText("Loaded records")).toBeTruthy();
});

test("shows the labeled skeleton after the configured delay and hands off accessibly", () => {
  vi.useFakeTimers();
  const view = render(panel(true));

  advanceSkeletonDelay();

  const root = view.container.querySelector(".loading-swap");
  const skeleton = view.container.querySelector(".loading-swap-skeleton");
  const content = view.container.querySelector(".loading-swap-content");

  expect(view.getByRole("status", { name: "Loading records" })).toBeTruthy();
  expect(root?.getAttribute("aria-busy")).toBe("true");
  expect(content?.getAttribute("aria-hidden")).toBe("true");
  expect(content?.hasAttribute("inert")).toBe(true);

  view.rerender(panel(false));

  expect(view.getByRole("status", { name: "Loading records" })).toBeTruthy();
  expect(root?.getAttribute("aria-busy")).toBe("true");
  expect(content?.getAttribute("aria-hidden")).toBe("true");
  expect(skeleton?.getAttribute("aria-hidden")).toBeNull();

  if (LOADING_SKELETON_CONFIG.minimumVisible > 1) {
    act(() => {
      vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.minimumVisible - 1);
    });

    expect(view.getByRole("status", { name: "Loading records" })).toBeTruthy();
  }

  act(() => {
    vi.advanceTimersByTime(1);
  });

  expect(view.queryByRole("status", { name: "Loading records" })).toBeNull();
  expect(root?.getAttribute("aria-busy")).toBeNull();
  expect(skeleton?.getAttribute("aria-hidden")).toBe("true");
  expect(skeleton?.hasAttribute("inert")).toBe(true);
  expect(content?.getAttribute("aria-hidden")).toBeNull();
  expect(content?.hasAttribute("inert")).toBe(false);
  expect(view.getByText("Loaded records")).toBeTruthy();
});

test("lets a parent own the busy announcement", () => {
  vi.useFakeTimers();

  const view = render(
    <LoadingSwap
      loading
      busy={false}
      skeleton={
        <LoadingSkeleton label="Loading records">Waiting</LoadingSkeleton>
      }
    >
      Loaded
    </LoadingSwap>,
  );

  advanceSkeletonDelay();

  expect(
    view.container.querySelector(".loading-swap")?.hasAttribute("aria-busy"),
  ).toBe(false);

  expect(view.getByRole("status", { name: "Loading records" })).toBeTruthy();
});

test("keeps the outgoing skeleton for the shared cross-fade", () => {
  vi.useFakeTimers();
  const view = render(panel(true));

  advanceSkeletonDelay();
  view.rerender(panel(false));
  expect(view.container.querySelector(".loading-swap-skeleton")).not.toBeNull();

  act(() => {
    vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.minimumVisible);
  });

  act(() => {
    vi.advanceTimersByTime(MOTION.loadingCrossfade - 1);
  });

  expect(view.container.querySelector(".loading-swap-skeleton")).not.toBeNull();

  act(() => {
    vi.advanceTimersByTime(1);
  });

  expect(view.container.querySelector(".loading-swap-skeleton")).toBeNull();
  expect(view.getByText("Loaded records")).toBeTruthy();
});

test("removes the outgoing skeleton after its minimum dwell with reduced motion", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const view = render(panel(true));

  advanceSkeletonDelay();
  view.rerender(panel(false));

  act(() => {
    vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.minimumVisible);
  });

  act(() => {
    vi.advanceTimersByTime(0);
  });

  expect(view.container.querySelector(".loading-swap-skeleton")).toBeNull();
});
