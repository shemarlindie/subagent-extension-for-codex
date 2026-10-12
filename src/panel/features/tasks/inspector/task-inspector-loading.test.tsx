// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Transport } from "../../../app/state/types";
import { MOTION } from "../../../shared/components/motion/motion-utils";
import { TaskInspector } from "./task-inspector";
import { TaskInspectorLoading } from "./task-inspector-loading";

test("shows a spinner instead of the empty message while tasks load", () => {
  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => true },
  );

  onTestFinished(cleanup);
  onTestFinished(() => controller.dispose());

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskInspector />
    </ControllerContext.Provider>,
  );

  expect(view.getByRole("status", { name: "Loading tasks" })).not.toBeNull();
  expect(view.queryByText("Task details will show here.")).toBeNull();
});

test("keeps the spinner through its fade-out, then removes it", () => {
  vi.useFakeTimers();
  onTestFinished(() => vi.useRealTimers());
  onTestFinished(cleanup);

  const view = render(<TaskInspectorLoading loading />);

  view.rerender(<TaskInspectorLoading loading={false} />);

  const leaving = view.container.querySelector(".task-inspector-loading");
  expect(leaving?.hasAttribute("data-leaving")).toBe(true);
  expect(view.queryByRole("status")).toBeNull();

  act(() => vi.advanceTimersByTime(MOTION.loadingCrossfade));

  expect(view.container.querySelector(".task-inspector-loading")).toBeNull();
});
