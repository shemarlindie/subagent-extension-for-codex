// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
  view.getByText("2", { selector: ".task-group-count" });

  // b0 is still running, so the dots follow the filters: unread, attention,
  // then working.
  assert.deepEqual(
    within(header)
      .getAllByRole("img")
      .map((dot) => dot.getAttribute("aria-label")),
    ["Needs input", "Running"],
  );

  assert.ok(
    getElement(header, ".unread-dot").compareDocumentPosition(
      within(header).getByRole("img", { name: "Needs input" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

test("a collapsed header flags hidden tasks waiting for a rate limit", async () => {
  const { toggle } = setup({
    tasks: [
      ...tasks,
      named("b1", "/repo/b", {
        live_activity: { text: "Waiting for rate limit reset", state: "info" },
      }),
    ],
  });

  const header = toggle("b");
  await userEvent.click(header);

  within(header).getByRole("img", { name: "Waiting for rate limit reset" });
});

test("long groups stop at a few rows until Show more, and Show less folds them again", async () => {
  const { rows, view } = setup();

  assert.deepEqual(rows("a"), ["a0", "a1", "a2", "a3", "a4"]);

  await userEvent.click(view.getByRole("button", { name: /^Show 2 more/ }));
  assert.equal(rows("a").length, 7);

  await userEvent.click(view.getByRole("button", { name: "Show less" }));
  assert.equal(rows("a").length, 5);
});

test("long groups show every row while searching or when one project is listed", () => {
  assert.equal(setup({ search: "a" }).rows("a").length, 7);
  cleanup();
  assert.equal(setup({ tasks: tasks.slice(0, 7) }).rows("a").length, 7);
});

test("bulk selection skips hidden rows and keeps picks hidden by Show less", async () => {
  const { view, toggle } = setup({ tasks: [...tasks, named("c0", "/repo/c")] });

  // a3 stays selected, so its menu acts on the selection as it is.
  const choose = async (name: string) => {
    fireEvent.contextMenu(view.getByRole("button", { name: /^a3/ }));

    await userEvent.click(await view.findByRole("menuitem", { name }));
  };

  const pressed = () =>
    view
      .queryAllByRole("button", { pressed: true })
      .map((row) => row.getAttribute("data-task"));

  fireEvent.click(toggle("b"));

  fireEvent.click(view.getByRole("button", { name: /^a3/ }), { ctrlKey: true });

  fireEvent.click(view.getByRole("button", { name: /^c0/ }), {
    shiftKey: true,
  });

  assert.deepEqual(pressed(), ["a3", "a4", "c0"]);

  await choose("Select all shown");
  assert.deepEqual(pressed(), ["a0", "a1", "a2", "a3", "a4", "c0"]);

  await userEvent.click(view.getByRole("button", { name: /^Show 2 more/ }));
  await choose("Select all shown");
  await userEvent.click(view.getByRole("button", { name: "Show less" }));
  await choose("Deselect shown");
  view.getByText("2 selected · 2 hidden");
  assert.deepEqual(pressed(), []);

  await userEvent.click(view.getByRole("button", { name: /^Show 2 more/ }));
  assert.deepEqual(pressed(), ["a5", "a6"]);

  // With every group collapsed, a header still opens the selection's menu.
  for (const name of ["a", "c"]) fireEvent.click(toggle(name));
  fireEvent.contextMenu(toggle("a"));
  await view.findByRole("menuitem", { name: /^Archive/ });
});
