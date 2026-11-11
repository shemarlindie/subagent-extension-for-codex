// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Task, Transport } from "../../../app/state/types";
import { TaskRow } from "./task-list";

function renderRow(row: Task) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskRow task={row} selected={false} />
    </ControllerContext.Provider>,
  );

  const element = view.container.querySelector<HTMLElement>("[data-task]");
  assert.ok(element);
  fireEvent.contextMenu(element);

  return { controller, view };
}

test("right-clicking an unread row offers Mark read", async () => {
  const unread = { ...task("a"), unread: true as const };
  const { controller, view } = renderRow(unread);
  const toggle = vi.spyOn(controller.taskActions.unread, "toggle");
  const select = vi.spyOn(controller, "select");

  await userEvent.click(
    await view.findByRole("menuitem", { name: "Mark read" }),
  );

  assert.deepEqual(toggle.mock.calls, [[unread]]);
  assert.equal(select.mock.calls.length, 0);
});

test("right-clicking a completed row offers Archive", async () => {
  const completed = { ...task("a"), status: "completed" as const };
  const { controller, view } = renderRow(completed);

  const archive = vi
    .spyOn(controller.taskActions.archive, "setArchived")
    .mockResolvedValue({ task_ids: [completed.id], skipped: [] });

  await userEvent.click(await view.findByRole("menuitem", { name: "Archive" }));

  assert.deepEqual(archive.mock.calls, [[[completed], true]]);
});
