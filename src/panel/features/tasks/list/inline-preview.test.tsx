// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Snapshot, Transport } from "../../../app/state/types";
import { LOADING_SKELETON_CONFIG } from "../../../shared/components/loading-skeleton/loading-skeleton-config";
import { MOTION } from "../../../shared/components/motion/motion-utils";
import { InlinePreview } from "./inline-preview";

afterEach(cleanup);
afterEach(() => vi.useRealTimers());

test("shows the task skeleton before the initial connection finishes", () => {
  vi.useFakeTimers();

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  let snapshot: Snapshot = controller.getSnapshot();

  const getSnapshot = vi
      .spyOn(controller, "getSnapshot")
      .mockImplementation(() => snapshot),
    preview = () => (
      <ControllerContext.Provider value={controller}>
        <InlinePreview />
      </ControllerContext.Provider>
    ),
    view = render(preview());

  act(() => {
    vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.delay);
  });

  expect(
    view.getByRole("status", { name: "Loading delegated tasks" }),
  ).toBeTruthy();

  snapshot = {
    ...snapshot,
    connected: false,
    taskListLoading: false,
    connection: "Open through MCP",
  };

  view.rerender(preview());

  act(() => {
    vi.advanceTimersByTime(
      LOADING_SKELETON_CONFIG.minimumVisible + MOTION.loadingCrossfade,
    );
  });

  expect(view.getByRole("status").textContent).toBe("Open through MCP");

  expect(
    view.queryByRole("status", { name: "Loading delegated tasks" }),
  ).toBeNull();

  controller.dispose();
  getSnapshot.mockRestore();
});
