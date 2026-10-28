// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Snapshot, Transport } from "../../../app/state/types";
import { TaskList } from "./task-list";

function setup(patch: Partial<Snapshot>) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const snapshot: Snapshot = {
    ...controller.getSnapshot(),
    connected: true,
    taskListLoading: false,
    tasks: [
      { ...task("a"), unread: true },
      { ...task("b"), unread: true },
      task("c"),
    ],
    filter: "unread",
    ...patch,
  };

  vi.spyOn(controller, "getSnapshot").mockReturnValue(snapshot);

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskList />
    </ControllerContext.Provider>,
  );

  return { view };
}

test("Unread replaces Clear filter with Mark all read unless there is a search", () => {
  const { view } = setup({});
  expect(view.queryByRole("button", { name: "Clear filter" })).toBeNull();
  expect(view.getByRole("button", { name: "Mark all read" })).toBeTruthy();
  cleanup();

  const searched = setup({ search: "review" }).view;
  expect(searched.getByRole("button", { name: "Mark all read" })).toBeTruthy();
  expect(searched.getByRole("button", { name: "Clear filter" })).toBeTruthy();
});
