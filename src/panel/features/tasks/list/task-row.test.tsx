// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test, vi } from "vitest";

import { task } from "../../../app/state/controller-test-harness";
import { TaskRow } from "./task-list";

test("right-clicking an unread row offers Mark read", async () => {
  onTestFinished(cleanup);

  const onSelect = vi.fn();
  const onToggleRead = vi.fn();

  const view = render(
    <TaskRow
      task={{ ...task("a"), unread: true }}
      selected={false}
      onSelect={onSelect}
      onToggleRead={onToggleRead}
      onArchive={() => {}}
    />,
  );

  const row = view.container.querySelector<HTMLElement>("[data-task]");
  assert.ok(row);
  fireEvent.contextMenu(row);

  await userEvent.click(
    await view.findByRole("menuitem", { name: "Mark read" }),
  );

  assert.equal(onToggleRead.mock.calls.length, 1);
  assert.equal(onSelect.mock.calls.length, 0);
});

test("right-clicking a completed row offers Archive", async () => {
  onTestFinished(cleanup);
  const onArchive = vi.fn();

  const view = render(
    <TaskRow
      task={{ ...task("a"), status: "completed" }}
      selected={false}
      onSelect={() => {}}
      onToggleRead={() => {}}
      onArchive={onArchive}
    />,
  );

  const row = view.container.querySelector<HTMLElement>("[data-task]");
  assert.ok(row);
  fireEvent.contextMenu(row);
  const item = await view.findByRole("menuitem", { name: "Archive" });
  await userEvent.click(item);

  assert.equal(onArchive.mock.calls.length, 1);
});
