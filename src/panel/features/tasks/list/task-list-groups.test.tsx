// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Snapshot, Task, Transport } from "../../../app/state/types";
import { getElement } from "../../../shared/utils/dom-test-harness";
import { TaskList } from "./task-list";

const named = (id: string, repository: string, patch: Partial<Task> = {}) => ({
  ...task(id, repository),
  title: id,
  ...patch,
});

// Seven tasks in /repo/a and one in /repo/b.
const tasks = [
  ...Array.from({ length: 7 }, (_, index) => named(`a${index}`, "/repo/a")),
  named("b0", "/repo/b"),
];

beforeEach(() => localStorage.clear());

function setup(patch: Partial<Snapshot> = {}) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  vi.spyOn(controller, "getSnapshot").mockReturnValue({
    ...controller.getSnapshot(),
    connected: true,
    taskListLoading: false,
    tasks,
    filter: "all",
    ...patch,
  });

  const list = () => (
    <ControllerContext.Provider value={controller}>
      <TaskList />
    </ControllerContext.Provider>
  );

  const view = render(list());

  // Shows a later snapshot, as when the controller publishes one.
  const update = (next: Partial<Snapshot>) => {
    vi.spyOn(controller, "getSnapshot").mockReturnValue({
      ...controller.getSnapshot(),
      ...next,
    });

    view.rerender(list());
  };

  const group = (name: string) =>
    view.getByRole("group", { name: new RegExp(`^${name}`) });

  const rows = (name: string) =>
    within(group(name))
      .queryAllByRole("button")
      .map((button) => button.getAttribute("data-task"))
      .filter(Boolean);

  const toggle = (name: string) =>
    getElement<HTMLElement>(group(name), ".task-group-toggle");

  return { view, rows, toggle, update };
}

test("choosing a task from outside the list opens its collapsed group", async () => {
  const { toggle, rows, update } = setup();

  await userEvent.click(toggle("b"));
  assert.deepEqual(rows("b"), []);

  update({ selected: "b0" });
  assert.deepEqual(rows("b"), ["b0"]);
});

test("a collapsed header flags hidden unread tasks and tasks waiting on input", async () => {
  const { toggle, view } = setup({
    tasks: [
      ...tasks,
      named("b1", "/repo/b", {
        unread: true,
        pending_input: {
          kind: "question",
          id: "i",
          tool: "AskUserQuestion",
          input: {},
        },
      }),
    ],
  });

  const header = toggle("b");

  assert.equal(within(header).queryByText("Unread"), null);
  await userEvent.click(header);
  within(header).getByText("Unread");
  within(header).getByRole("img", { name: "Needs input" });
  view.getByText("2", { selector: ".task-group-count" });
});

test("long groups stop at a few rows until Show more, and Show less folds them again", async () => {
  const { rows, view } = setup();

  assert.deepEqual(rows("a"), ["a0", "a1", "a2", "a3", "a4"]);

  await userEvent.click(view.getByRole("button", { name: "Show 2 more" }));
  assert.equal(rows("a").length, 7);

  await userEvent.click(view.getByRole("button", { name: "Show less" }));
  assert.equal(rows("a").length, 5);
});

test("long groups show every row while searching or when one project is listed", () => {
  assert.equal(setup({ search: "a" }).rows("a").length, 7);
  cleanup();
  assert.equal(setup({ tasks: tasks.slice(0, 7) }).rows("a").length, 7);
});
