// @vitest-environment jsdom
import { fireEvent, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";

import type { ChatItem } from "../../../../core/shared/tasks/conversation/chat";
import type { WrapUp } from "../../../../core/shared/tasks/wrap-up-contract";
import { getElement } from "../../../shared/utils/dom-test-harness";
import { base, sent, setup } from "./chat-panel-test-harness";

const reply = (turn: number, wrapUp: WrapUp): ChatItem => ({
  kind: "message",
  id: `reply_${turn}`,
  event_id: turn,
  message: {
    id: `reply_${turn}`,
    event_id: turn,
    timestamp: "2026-10-10T00:00:00Z",
    turn,
    from: "worker",
    kind: "reply",
    text: `Reply ${turn}`,
    wrap_up: wrapUp,
  },
});

const buttons = (container: HTMLElement, id: string) =>
  within(getElement(container, `[data-message="${id}"] .wrap-up`))
    .queryAllByRole("button")
    .map((button) => button.textContent);

test("the latest turn's wrap-up answers with its buttons until the next message, and earlier ones keep only their text", async () => {
  const { view, tool, updateTask } = setup(
    { turn: 2 },
    [],
    [
      reply(1, {
        recap: "Found the cause.",
        ask: "Fix it?",
        actions: [{ label: "Yes, fix it" }],
      }),
      reply(2, {
        recap: "Fixed it.",
        ask: "Ship it?",
        actions: [{ label: "Yes, ship it" }],
      }),
    ],
  );

  expect(buttons(view.container, "reply_1")).toEqual([]);
  expect(view.getByText("Fix it?")).toBeTruthy();
  expect(buttons(view.container, "reply_2")).toEqual(["Yes, ship it"]);
  fireEvent.click(view.getByRole("button", { name: "Yes, ship it" }));

  await waitFor(() =>
    expect(sent(tool)).toContainEqual([
      "app_send_message",
      expect.objectContaining({ task_id: "task-1", message: "Yes, ship it" }),
    ]),
  );

  updateTask({ status: "running", turn: 3 });
  expect(buttons(view.container, "reply_2")).toEqual([]);
  expect(view.getByText("Fixed it.")).toBeTruthy();
});

test("a spent budget holds the buttons until it's raised", () => {
  const { view } = setup(
    {
      turn: 1,
      budget: { ...base.budget, max_cost_usd: 1 },
      cost_usd: 1.2,
    },
    [],
    [
      reply(1, {
        recap: "Found it.",
        ask: "Fix it?",
        actions: [{ label: "Yes" }],
      }),
    ],
  );

  expect(view.getByText("Fix it?")).toBeTruthy();
  expect(buttons(view.container, "reply_1")).toEqual([]);
});
