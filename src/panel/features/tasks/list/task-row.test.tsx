// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Task, Transport } from "../../../app/state/types";
import { TaskRow } from "./task-row";

function renderRow(row: Task) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskRow task={row} current={false} />
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

test("a row names its title, worker, unread state and status", () => {
  const unread = {
    ...task("a"),
    title: "Plan the rollout",
    status: "completed" as const,
    unread: true as const,
  };

  const { view } = renderRow(unread);

  // The open context menu hides the row from the accessibility tree. Without
  // layout, jsdom joins the inline parts without spaces.
  view.getByRole("button", {
    name: /^Plan the rollout\s*reviewer\s*Unread\s*Completed$/,
    hidden: true,
  });
});

test("a row counts its plan's steps while some are left", () => {
  const steps = (...done: boolean[]) =>
    done.map((d, i) => ({
      content: `Step ${i + 1}`,
      status: d ? ("completed" as const) : ("pending" as const),
    }));

  const count = (row: Task) =>
    renderRow(row)
      .view.container.querySelector(".row-plan")
      ?.textContent?.replace("Plan, ", " · ");

  const plan = (s: ReturnType<typeof steps>) => ({
    ...task("a"),
    plan: { steps: s, turn: 1, updated_at: "" },
  });

  assert.equal(
    count(plan(steps(true, false, false))),
    "1/3 · 1 of 3 steps done",
  );

  assert.equal(count(plan(steps(true, true))), undefined);
});

test("an idle row shows its latest question, and nothing for a recap alone", () => {
  const reply = { turn: 1, text: "r", recap: "Tests pass." };

  const ask = (patch: Partial<Task>) =>
    renderRow({
      ...task("a"),
      status: "completed",
      turn: 1,
      reply: { ...reply, ask: "Commit it?" },
      ...patch,
    }).view.container.querySelector(".row-ask")?.textContent;

  assert.equal(ask({}), "Commit it?");
  assert.equal(ask({ reply }), undefined);
  assert.equal(ask({ status: "running", turn: 2 }), undefined);
});
