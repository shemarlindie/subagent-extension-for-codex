// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { task } from "../../../app/state/controller-test-harness";
import { TaskRow } from "./task-list";

test.each([
  [false, "Mark unread"],
  [true, "Mark read"],
] as const)(
  "right-clicking a row offers the opposite of its read state (unread: %s)",
  async (unread, label) => {
    onTestFinished(cleanup);

    const onSelect = vi.fn(),
      onToggleRead = vi.fn();

    const view = render(
      <TaskRow
        task={{ ...task("a"), ...(unread ? { unread } : {}) }}
        selected={false}
        onSelect={onSelect}
        onToggleRead={onToggleRead}
        onArchive={() => {}}
      />,
    );

    const row = view.container.querySelector<HTMLElement>("[data-task]");
    assert.ok(row);
    expect(row.hasAttribute("data-unread")).toBe(unread);
    expect(view.queryByText("Unread") !== null).toBe(unread);

    expect(row.querySelector(".row-worker")?.getAttribute("title")).toBe(
      task("a").worker_profile.replaceAll("_", " "),
    );

    fireEvent.contextMenu(row);
    await userEvent.click(await view.findByRole("menuitem", { name: label }));

    assert.equal(onToggleRead.mock.calls.length, 1);
    assert.equal(onSelect.mock.calls.length, 0);
  },
);

test.each([
  ["completed", false],
  ["running", true],
] as const)(
  "right-clicking a %s row offers Archive (disabled: %s)",
  async (status, disabled) => {
    onTestFinished(cleanup);
    const onArchive = vi.fn();

    const view = render(
      <TaskRow
        task={{ ...task("a"), status }}
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
    expect(item.hasAttribute("data-disabled")).toBe(disabled);
    await userEvent.click(item);

    assert.equal(onArchive.mock.calls.length, disabled ? 0 : 1);
  },
);
