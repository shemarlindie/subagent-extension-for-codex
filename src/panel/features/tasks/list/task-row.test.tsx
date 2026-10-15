// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { task } from "../../../app/state/controller-test-harness";
import { TaskRow } from "./task-list";

test.each([
  [false, "Mark as unseen"],
  [true, "Mark as seen"],
] as const)(
  "right-clicking a row offers the opposite of its seen state (unseen: %s)",
  async (unseen, label) => {
    onTestFinished(cleanup);

    const onSelect = vi.fn(),
      onToggleSeen = vi.fn();

    const view = render(
      <TaskRow
        task={{ ...task("a"), ...(unseen ? { unseen } : {}) }}
        selected={false}
        onSelect={onSelect}
        onToggleSeen={onToggleSeen}
      />,
    );

    const row = view.container.querySelector<HTMLElement>("[data-task]");
    assert.ok(row);
    expect(row.hasAttribute("data-unseen")).toBe(unseen);
    expect(view.queryByText("Unseen") !== null).toBe(unseen);

    fireEvent.contextMenu(row);
    await userEvent.click(await view.findByRole("menuitem", { name: label }));

    assert.equal(onToggleSeen.mock.calls.length, 1);
    assert.equal(onSelect.mock.calls.length, 0);
  },
);
