// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, fireEvent, waitFor } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import {
  rateLimit,
  Timeline,
} from "../../../../../dev/panel/scenarios/timeline";
import type { ChatItem } from "../../../../shared/tasks/conversation/chat";
import { deferred, flush } from "../../../app/state/controller-test-harness";
import type { Task } from "../../../app/state/types";
import { sent, setup } from "./chat-panel-test-harness";

test.each([false, true])(
  "Stop explains a pending shutdown with composer collapsed: %s",
  async (collapsed) => {
    const { view, tool } = setup({ status: "running" });
    const stopping = deferred<unknown>();
    tool.mockReturnValue(stopping.promise);

    if (collapsed) {
      fireEvent.click(view.getByRole("button", { name: "Hide composer" }));
    }

    fireEvent.click(view.getByRole("button", { name: "Stop the turn" }));
    expect(view.getByText("Stopping the current turn…")).toBeTruthy();

    expect(
      (view.getByRole("button", { name: "Stop the turn" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => {
      stopping.resolve({});
      await flush();
    });

    expect(view.queryByText("Stopping the current turn…")).toBeNull();

    expect(
      (view.getByRole("button", { name: "Stop the turn" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  },
);

test("keeps the real composer disabled while the initial chat read is pending", () => {
  const { composer } = setup({}, [], null);

  assert.equal((composer as HTMLTextAreaElement).disabled, true);
});

test.each([
  { from: "worker" as const, turn: 1, grouped: true, note: false },
  { from: "worker" as const, turn: 2, grouped: false, note: false },
  { from: "user" as const, turn: 1, grouped: false, note: false },
  { from: "worker" as const, turn: 1, grouped: false, note: true },
])(
  "outcomes group only with the preceding worker response: %j",
  async (scenario) => {
    const items: ChatItem[] = [
      {
        kind: "message",
        id: "response",
        event_id: 1,
        message: {
          id: "response",
          event_id: 1,
          timestamp: "2026-10-09T12:00:00Z",
          turn: scenario.turn,
          from: scenario.from,
          kind: "message",
          text: "Response text",
        },
      },
      {
        kind: "outcome",
        id: "outcome",
        event_id: 2,
        timestamp: "2026-10-09T12:00:01Z",
        turn: 1,
        outcome: "completed",
        runtime_ms: 1000,
        cost_usd: 0,
      },
    ];

    if (scenario.note) {
      items.splice(1, 0, {
        kind: "note",
        id: "note",
        event_id: 2,
        timestamp: "2026-10-09T12:00:00Z",
        note: "compaction",
        text: "Context compacted",
      });
    }

    const { view } = setup({}, [], items);
    const outcome = view.container.querySelector('[data-chat-item="outcome"]');

    assert.ok(outcome);
    assert.equal(view.container.querySelectorAll(".chat-outcome").length, 1);
    assert.equal(!!outcome.closest(".chat-message"), scenario.grouped);

    assert.equal(
      !!view.queryByRole("button", { name: "Copy response" }),
      scenario.grouped,
    );

    assert.ok(view.getByRole("button", { name: "View activity" }));

    if (scenario.grouped) {
      const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      const writeText = vi.fn(async () => {});

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      onTestFinished(() => {
        if (original) Object.defineProperty(navigator, "clipboard", original);
        else Reflect.deleteProperty(navigator, "clipboard");
      });

      fireEvent.click(view.getByRole("button", { name: "Copy response" }));

      await waitFor(() =>
        assert.deepEqual(writeText.mock.calls, [["Response text"]]),
      );

      await view.findByRole("button", { name: "Copy response — copied" });
    }
  },
);

for (const source of ["live activity", "events"] as const) {
  test(`rate-limit waiting shows a paused status from ${source}`, () => {
    const { view } = setup(
      {
        status: "running",
        live_activity:
          source === "live activity"
            ? { text: "Waiting for rate limit reset", state: "info" }
            : undefined,
      },
      source === "events"
        ? rateLimit(
            new Timeline("task-1", "2026-10-09T12:00:00Z", 1),
            "rejected",
          ).events
        : [],
    );

    const status = view.container.querySelector<HTMLElement>(".chat-working");

    assert.ok(status);
    assert.equal(status.textContent, "Waiting for rate limit reset");
    assert.ok(status.querySelector(".row-status-icon.paused"));
    expect(status.querySelector(".running")).toBeNull();
  });
}

test("on an idle task, Enter sends the message, which starts the next turn", async () => {
  const { tool, composer, type, view } = setup();
  type("Next, add tests");
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    expect(sent(tool)).toEqual([
      [
        "app_send_message",
        {
          task_id: "task-1",
          message: "Next, add tests",
          delivery: "steer",
          request_id: expect.any(String),
        },
      ],
    ]),
  );

  await waitFor(() =>
    assert.equal((composer as HTMLTextAreaElement).value, ""),
  );

  // Shift+Enter is a new line, and Tab and Esc keep their usual roles.
  type("Two");
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(composer, { key: "Tab" });
  fireEvent.keyDown(composer, { key: "Escape" });
  assert.equal(tool.mock.calls.length, 1);
  assert.ok(view.getByRole("button", { name: "Send" }));
});

test("while the worker waits for input, Enter and Ctrl+Enter only queue", async () => {
  const { tool, type, view } = setup({
    status: "waiting",
    pending_input: { id: "r", tool: "Bash", kind: "permission", input: {} },
  });

  fireEvent.click(view.getByRole("button", { name: "Show composer" }));
  const composer = view.getByRole("textbox", { name: "Message" });

  type("Later");
  expect(view.queryByRole("button", { name: "Steer" })).toBeNull();
  fireEvent.keyDown(composer, { key: "Enter", ctrlKey: true });

  await waitFor(() =>
    expect(sent(tool)).toEqual([
      [
        "app_send_message",
        {
          task_id: "task-1",
          message: "Later",
          delivery: "queue",
          request_id: expect.any(String),
        },
      ],
    ]),
  );
});

const questionInput = (id: string): Task["pending_input"] => ({
  id,
  tool: "AskUserQuestion",
  kind: "question",
  input: { questions: [{ question: "Which approach?" }] },
});

test("composer expansion and collapse animate directly between their heights without stacking variants", () => {
  const animations: {
    element: HTMLElement;
    frames: Keyframe[];
    animation: { onfinish: (() => void) | null; cancel(): void };
  }[] = [];

  const animateDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, frames: Keyframe[]) {
      const animation = { onfinish: null, cancel() {} };

      animations.push({ element: this, frames, animation });

      return animation;
    },
  });

  const height = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("chat-composer")) return 0;

      return (
        (this.querySelector(".chat-composer-toggle-row") ? 28 : 0) +
        (this.querySelector(".chat-composer-body") ? 64 : 0)
      );
    });

  vi.stubGlobal("matchMedia", () => ({ matches: false }));

  onTestFinished(() => {
    height.mockRestore();
    vi.unstubAllGlobals();

    if (animateDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "animate",
        animateDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  const { view, updateTask } = setup({ status: "running" });
  const composer = view.container.querySelector(".chat-composer");

  updateTask({ status: "waiting", pending_input: questionInput("request") });

  const composerAnimations = () =>
    animations.filter(({ frames }) => frames.some((frame) => frame.height));

  const initialCollapse = composerAnimations().at(-1)!;

  act(() => initialCollapse.animation.onfinish?.());
  animations.length = 0;

  fireEvent.click(view.getByRole("button", { name: "Show composer" }));
  expect(view.container.querySelector(".chat-composer")).toBe(composer);
  expect(composer?.querySelector(".chat-composer-toggle-row")).toBeNull();
  assert.ok(composer?.querySelector(".chat-composer-body"));

  const [expansion] = composerAnimations();

  assert.equal(composerAnimations().length, 1);
  assert.ok(expansion);
  expect(expansion.element).toBe(composer);

  act(() => expansion.animation.onfinish?.());
  animations.length = 0;

  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));
  expect(view.container.querySelector(".chat-composer")).toBe(composer);
  assert.ok(composer?.querySelector(".chat-composer-toggle-row"));
  expect(composer?.querySelector(".chat-composer-body")).toBeNull();

  const [collapse] = composerAnimations();

  assert.equal(composerAnimations().length, 1);
  assert.ok(collapse);
  expect(collapse.element).toBe(composer);
});

test("Stop moves continuously between expanded and collapsed composer layouts and stays operational", async () => {
  const animations: {
    element: HTMLElement;
  }[] = [];

  const animateDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement) {
      animations.push({ element: this });

      return { cancel() {} };
    },
  });

  const bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const composer = this.closest(".chat-composer");
      const expanded = !!composer?.querySelector(".chat-composer-body");
      // The composer itself shifts during its height transition. Only the
      // control's position relative to that container should be compensated.
      const origin = expanded ? 100 : 140;

      const top =
        origin +
        (this.getAttribute("data-action") === "stop" && expanded ? 7 : 0);

      return { top, left: 0, width: 28, height: 28 } as DOMRect;
    });

  vi.stubGlobal("matchMedia", () => ({ matches: false }));

  onTestFinished(() => {
    bounds.mockRestore();
    vi.unstubAllGlobals();

    if (animateDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "animate",
        animateDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  const { view, tool } = setup({ status: "running" });

  const stopAnimations = () =>
    animations.filter(
      ({ element }) => element.getAttribute("data-action") === "stop",
    );

  const assertSingleStop = () => {
    assert.equal(
      view.getAllByRole("button", { name: "Stop the turn" }).length,
      1,
    );

    assert.equal(
      view.container.querySelectorAll('[data-action="stop"]').length,
      1,
    );
  };

  assertSingleStop();
  animations.length = 0;
  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));
  assertSingleStop();
  const [hideStop] = stopAnimations();
  assert.equal(stopAnimations().length, 1);
  assert.ok(hideStop);

  fireEvent.click(view.getByRole("button", { name: "Stop the turn" }));

  await waitFor(() => assert.equal(tool.mock.calls.length, 1));

  animations.length = 0;
  fireEvent.click(view.getByRole("button", { name: "Show composer" }));
  assertSingleStop();
  const [showStop] = stopAnimations();
  assert.equal(stopAnimations().length, 1);
  assert.ok(showStop);

  fireEvent.click(view.getByRole("button", { name: "Stop the turn" }));

  await waitFor(() =>
    expect(sent(tool)).toEqual([
      ["interrupt_task", { task_id: "task-1", send_pending: false }],
      ["interrupt_task", { task_id: "task-1", send_pending: false }],
    ]),
  );
});

test("an idle composer can hide and reopen its draft without offering Stop", () => {
  const { view, type } = setup();
  type("Keep the next turn draft");

  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));

  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(view.queryByRole("button", { name: "Stop the turn" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Show composer (draft)" }));

  const composer = view.getByRole("textbox", { name: "Message" });

  assert.equal(
    (composer as HTMLTextAreaElement).value,
    "Keep the next turn draft",
  );

  expect(document.activeElement).toBe(composer);
});

test("composer visibility is remembered separately for each task", () => {
  const { view, type, updateTask } = setup();
  type("First task draft");
  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));

  updateTask({ id: "task-2" });
  assert.ok(view.getByRole("textbox", { name: "Message" }));
  assert.ok(view.getByRole("button", { name: "Hide composer" }));

  updateTask({ id: "task-1" });
  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Show composer (draft)" }));

  assert.equal(
    (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .value,
    "First task draft",
  );
});

test("an empty question starts with the composer collapsed and offers fallback review", () => {
  const { view, tool } = setup({
    status: "waiting",
    pending_input: {
      id: "empty-question",
      tool: "AskUserQuestion",
      kind: "question",
      input: { questions: [] },
    },
  });

  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(view.getByRole("button", { name: "Show composer" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Stop the turn" })).toBeTruthy();
  expect(tool).not.toHaveBeenCalled();
  expect(view.getByRole("button", { name: "Review request" })).toBeTruthy();
});

test("permission requests auto-hide the composer and restore its draft afterwards", () => {
  const pending = {
    id: "permission",
    tool: "Bash",
    kind: "permission" as const,
    input: {},
  };

  const { view, type, updateTask } = setup({ status: "running" });
  type("Saved draft");
  updateTask({ status: "waiting", pending_input: pending });
  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
  assert.ok(view.getByRole("button", { name: "Stop the turn" }));

  fireEvent.click(view.getByRole("button", { name: "Show composer (draft)" }));

  expect(
    (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .value,
  ).toBe("Saved draft");

  updateTask({
    status: "waiting",
    pending_input: { ...pending, id: "next-request" },
  });

  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
  updateTask({ status: "running", pending_input: undefined });

  expect(
    (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .value,
  ).toBe("Saved draft");
});

test("question toggles preserve the ordinary composer's hidden preference", () => {
  const pending = questionInput("request")!;

  const { view, updateTask } = setup({ status: "running" });
  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));

  updateTask({ status: "waiting", pending_input: pending });
  fireEvent.click(view.getByRole("button", { name: "Show composer" }));
  assert.ok(view.getByRole("textbox", { name: "Message" }));

  updateTask({ status: "running", pending_input: undefined });
  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
  assert.ok(view.getByRole("button", { name: "Show composer" }));
});

test("questions collapse the composer while preserving its draft and Stop action", async () => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  onTestFinished(() => focus.mockRestore());
  const { tool, view, type, updateTask } = setup({ status: "running" });
  type("Keep this draft");
  updateTask({ status: "waiting", pending_input: questionInput("request") });

  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(view.queryByText(/Enter to queue/)).toBeNull();

  const show = view.getByRole("button", { name: "Show composer (draft)" });

  const controlled = document.getElementById(
    show.getAttribute("aria-controls")!,
  );

  assert.ok(controlled);
  fireEvent.click(show);

  const composer = view.getByRole("textbox", { name: "Message" });

  expect(document.activeElement).toBe(composer);
  expect(focus.mock.instances.at(-1)).toBe(composer);
  assert.deepEqual(focus.mock.lastCall, [{ preventScroll: true }]);
  assert.equal((composer as HTMLTextAreaElement).value, "Keep this draft");
  const collapse = view.getByRole("button", { name: "Hide composer" });
  const composerBox = composer.closest(".chat-composer-box");

  expect(document.getElementById(collapse.getAttribute("aria-controls")!)).toBe(
    controlled,
  );

  expect(collapse.closest(".chat-composer-box")).toBeNull();
  expect(collapse.parentElement).toBe(composerBox?.parentElement);

  assert.ok(
    collapse.compareDocumentPosition(composer) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );

  assert.equal(collapse.textContent, "");
  fireEvent.change(composer, { target: { value: "After the answer" } });
  fireEvent.click(collapse);
  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();

  expect(document.activeElement).toBe(
    view.getByRole("button", { name: "Show composer (draft)" }),
  );

  expect(
    document.getElementById(
      document.activeElement!.getAttribute("aria-controls")!,
    ),
  ).toBe(controlled);

  expect(focus.mock.instances.at(-1)).toBe(document.activeElement);
  assert.deepEqual(focus.mock.lastCall, [{ preventScroll: true }]);

  fireEvent.click(view.getByRole("button", { name: "Stop the turn" }));

  await waitFor(() =>
    expect(sent(tool)).toEqual([
      ["interrupt_task", { task_id: "task-1", send_pending: false }],
    ]),
  );

  updateTask({ status: "running", pending_input: undefined });

  assert.equal(
    (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .value,
    "After the answer",
  );

  assert.ok(view.getByRole("button", { name: "Steer" }));
  assert.ok(view.getByRole("button", { name: "Hide composer" }));
});
