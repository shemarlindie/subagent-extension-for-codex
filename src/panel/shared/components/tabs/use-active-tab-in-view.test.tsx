// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useActiveTabInView } from "./use-active-tab-in-view";

afterEach(cleanup);

function TabsHarness({
  value,
  layoutKey,
}: {
  value: string;
  layoutKey: string;
}) {
  const listRef = useActiveTabInView(value, { layoutKey });

  return (
    <div ref={listRef} role="tablist">
      <button id="tab-task" role="tab" aria-selected={value === "task"}>
        Task
      </button>
      <button id="tab-models" role="tab" aria-selected={value === "models"}>
        Models
      </button>
    </div>
  );
}

test("scrolls the selected tab into view when selection or layout changes", () => {
  const view = render(<TabsHarness value="task" layoutKey="vertical" />),
    list = view.getByRole("tablist"),
    task = view.getByRole("tab", { name: "Task" }),
    models = view.getByRole("tab", { name: "Models" }),
    scrollTo = vi.fn();

  Object.defineProperty(list, "clientWidth", {
    configurable: true,
    value: 100,
  });

  Object.defineProperty(task, "offsetLeft", { configurable: true, value: 12 });
  Object.defineProperty(task, "offsetWidth", { configurable: true, value: 50 });

  Object.defineProperty(models, "offsetLeft", {
    configurable: true,
    value: 120,
  });

  Object.defineProperty(models, "offsetWidth", {
    configurable: true,
    value: 50,
  });

  Object.defineProperty(list, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });

  view.rerender(<TabsHarness value="task" layoutKey="horizontal" />);
  expect(scrollTo).not.toHaveBeenCalled();

  view.rerender(<TabsHarness value="models" layoutKey="horizontal" />);

  expect(scrollTo).toHaveBeenLastCalledWith({
    left: 82,
    behavior: expect.any(String),
  });

  Object.defineProperty(list, "scrollLeft", {
    configurable: true,
    value: 150,
  });

  view.rerender(<TabsHarness value="models" layoutKey="vertical" />);

  expect(scrollTo).toHaveBeenLastCalledWith({
    left: 108,
    behavior: expect.any(String),
  });
});
