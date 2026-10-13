// @vitest-environment jsdom
import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { ControllerContext } from "../../../app/state/controller-context";
import { setup, task } from "../../../app/state/controller-test-harness";
import { MOTION } from "../../../shared/components/motion/motion-utils";
import { TaskInspector } from "./task-inspector";
import { TaskInspectorLoading } from "./task-inspector-loading";

function renderInspector() {
  const { controller } = setup(true);

  onTestFinished(cleanup);
  onTestFinished(() => controller.dispose());

  return {
    controller,
    view: render(
      <ControllerContext.Provider value={controller}>
        <Tooltip.Provider>
          <TaskInspector />
        </Tooltip.Provider>
      </ControllerContext.Provider>,
    ),
  };
}

test("shows a spinner until loading ends, then the empty message when nothing is selected", () => {
  const { controller, view } = renderInspector();

  expect(view.getByRole("status", { name: "Loading tasks" })).not.toBeNull();
  expect(view.queryByText("Task details will show here.")).toBeNull();

  act(() => {
    controller.applyScope(
      { panel_scope: { conversation_id: "chat" }, tasks: [] },
      false,
    );
  });

  expect(view.queryByRole("status", { name: "Loading tasks" })).toBeNull();
  expect(view.getByText("Task details will show here.")).not.toBeNull();
});

test("opens the default task from opening data without showing the empty message", () => {
  const { controller, view } = renderInspector();

  act(() => {
    controller.applyScope(
      {
        panel_scope: { conversation_id: "chat" },
        tasks: [task("a", "/repo/a", "chat")],
      },
      false,
    );
  });

  const inspector = view.getByRole("region", { name: "Task inspector" });
  expect(inspector.dataset.task).toBe("a");
  expect(view.queryByText("Task details will show here.")).toBeNull();
});

test("keeps the spinner through its fade-out, then removes it", () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  onTestFinished(cleanup);

  const view = render(<TaskInspectorLoading loading />);

  view.rerender(<TaskInspectorLoading loading={false} />);

  const leaving = view.container.querySelector(".task-inspector-loading");
  expect(leaving?.hasAttribute("data-leaving")).toBe(true);
  expect(view.queryByRole("status")).toBeNull();

  act(() => {
    vi.advanceTimersByTime(MOTION.loadingCrossfade);
  });

  expect(view.container.querySelector(".task-inspector-loading")).toBeNull();
});
