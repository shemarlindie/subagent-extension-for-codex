// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { previewEvents } from "../../../../../dev/panel/scenarios/fixtures";
import type { ChatItem } from "../../../../shared/tasks/conversation/chat";
import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Event, Task, Transport } from "../../../app/state/types";
import { ChatPanel } from "./chat-panel";

const base: Task = {
  id: "task-1",
  repository: "/repo",
  revision: "HEAD",
  provider: "claude",
  worker_profile: "implementer",
  title: "Implement",
  description: "Implement the change",
  depends_on: [],
  context: [],
  workspace_strategy: "worktree",
  budget: { max_runtime_minutes: 20, max_cost_usd: 5 },
  owner: "owner",
  status: "completed",
  created_at: "",
  updated_at: "",
  instructions: [],
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 60000,
  cost_usd: 1,
};

function setup(
  patch: Partial<Task> = {},
  events: Event[] = [],
  chatItems?: ChatItem[],
) {
  onTestFinished(cleanup);
  const task = { ...base, ...patch };

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());
  const tool = vi.spyOn(controller, "tool").mockResolvedValue({});
  vi.spyOn(controller, "refresh").mockResolvedValue();

  const snapshot = {
    ...controller.getSnapshot(),
    events,
    chat:
      chatItems === undefined
        ? undefined
        : { task: task.id, items: chatItems, cursor: chatItems.length },
  };

  const getSnapshot = controller.getSnapshot.bind(controller);
  let snapshotBusy = snapshot.busy;
  let visibleSnapshot = snapshot;

  vi.spyOn(controller, "getSnapshot").mockImplementation(() => {
    const busy = getSnapshot().busy;

    if (busy !== snapshotBusy) {
      snapshotBusy = busy;
      visibleSnapshot = { ...snapshot, busy };
    }

    return visibleSnapshot;
  });

  const panel = (current: Task) => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <ChatPanel task={current} />
      </Tooltip.Provider>
    </ControllerContext.Provider>
  );

  const view = render(panel(task));

  const updateTask = (patch: Partial<Task>) =>
    view.rerender(panel({ ...task, ...patch }));

  const composer = view.getByRole("textbox", { name: "Message" });

  const type = (text: string) =>
    fireEvent.change(composer, { target: { value: text } });

  return { controller, task, tool, view, composer, type, updateTask };
}

const sent = (tool: ReturnType<typeof setup>["tool"]) =>
  tool.mock.calls.map(([name, args]) => [name, args]);

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

      assert.ok(
        await view.findByRole("button", { name: "Copy response — copied" }),
      );
    }
  },
);

test("Chat exposes a scroll-to-latest control and returns focus to its history", () => {
  const notes: ChatItem[] = Array.from({ length: 6 }, (_, index) => ({
    kind: "note",
    id: `note-${index}`,
    event_id: index,
    timestamp: "",
    note: "compaction",
    text: `Note ${index}`,
  }));

  const { view } = setup({}, [], notes);
  const history = view.getByRole("region", { name: "Chat history" });
  let scrollTop = 400;

  Object.defineProperties(history, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 600 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
  });

  history.scrollTop = 100;
  fireEvent.scroll(history);

  fireEvent.click(
    view.getByRole("button", { name: "Scroll to latest message" }),
  );

  assert.equal(history.scrollTop, 400);
  expect(document.activeElement).toBe(history);

  expect(
    view.queryByRole("button", { name: "Scroll to latest message" }),
  ).toBeNull();
});

test("dependency waiting shows a paused status instead of the running indicator", () => {
  const { view } = setup({
    status: "waiting",
    waiting_reason: "waiting_for_dependency",
  });

  const status = view.getByRole("status");

  assert.equal(status.textContent, "Waiting on dependency");
  assert.ok(status.querySelector(".row-status-icon.waiting"));
  expect(status.querySelector(".running")).toBeNull();

  assert.equal(
    status.querySelector("svg")?.getAttribute("aria-hidden"),
    "true",
  );
});

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
        ? previewEvents.filter(
            (event) => event.task_id === "preview-live-rate-limited",
          )
        : [],
    );

    const status = view.getByRole("status");

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
    assert.deepEqual(sent(tool), [
      [
        "send_user_agent_message",
        { task_id: "task-1", message: "Next, add tests", delivery: "steer" },
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

test("while a turn runs, Enter steers, Tab queues and Esc stops, and an empty composer offers Stop", async () => {
  const { tool, composer, type, view } = setup({ status: "running" });
  assert.ok(view.getByRole("button", { name: "Stop the turn" }));

  type("Mind the edge cases");
  assert.ok(view.getByRole("button", { name: "Steer" }));
  assert.ok(view.getByRole("button", { name: "Queue" }));
  fireEvent.keyDown(composer, { key: "Enter" });
  await waitFor(() => assert.equal(tool.mock.calls.length, 1));

  await waitFor(() =>
    assert.equal((composer as HTMLTextAreaElement).value, ""),
  );

  type("Afterwards, the docs");
  fireEvent.keyDown(composer, { key: "Tab" });
  await waitFor(() => assert.equal(tool.mock.calls.length, 2));

  fireEvent.keyDown(composer, { key: "Escape" });
  await waitFor(() => assert.equal(tool.mock.calls.length, 3));

  assert.deepEqual(sent(tool), [
    [
      "send_user_agent_message",
      { task_id: "task-1", message: "Mind the edge cases", delivery: "steer" },
    ],
    [
      "send_user_agent_message",
      { task_id: "task-1", message: "Afterwards, the docs", delivery: "queue" },
    ],
    ["interrupt_agent_task", { task_id: "task-1", send_pending: false }],
  ]);
});

test("while the worker waits for input, Enter only queues", async () => {
  const { tool, composer, type, view } = setup({
    status: "waiting",
    pending_input: { id: "r", tool: "Bash", kind: "permission", input: {} },
  });

  type("Later");
  expect(view.queryByRole("button", { name: "Steer" })).toBeNull();
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "send_user_agent_message",
        { task_id: "task-1", message: "Later", delivery: "queue" },
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

    if (animateDescriptor)
      Object.defineProperty(
        HTMLElement.prototype,
        "animate",
        animateDescriptor,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
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
  expect(expansion.element).toBe(composer);

  assert.deepEqual(
    expansion.frames.map((frame) => frame.height),
    ["28px", "64px"],
  );

  act(() => expansion.animation.onfinish?.());
  animations.length = 0;

  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));
  expect(view.container.querySelector(".chat-composer")).toBe(composer);
  assert.ok(composer?.querySelector(".chat-composer-toggle-row"));
  expect(composer?.querySelector(".chat-composer-body")).toBeNull();

  const [collapse] = composerAnimations();

  assert.equal(composerAnimations().length, 1);
  expect(collapse.element).toBe(composer);

  assert.deepEqual(
    collapse.frames.map((frame) => frame.height),
    ["64px", "28px"],
  );
});

test("Stop moves continuously between expanded and collapsed composer layouts and stays operational", async () => {
  const animations: {
    element: HTMLElement;
    frames: Keyframe[];
    timing: KeyframeAnimationOptions;
  }[] = [];

  const animateDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(
      this: HTMLElement,
      frames: Keyframe[],
      timing: KeyframeAnimationOptions,
    ) {
      animations.push({ element: this, frames, timing });

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

    if (animateDescriptor)
      Object.defineProperty(
        HTMLElement.prototype,
        "animate",
        animateDescriptor,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
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
  assert.equal(stopAnimations().length, 1);
  assert.equal(stopAnimations()[0].timing.duration, 180);

  assert.deepEqual(stopAnimations()[0].frames, [
    { transform: "translateY(7px)" },
    { transform: "none" },
  ]);

  fireEvent.click(view.getByRole("button", { name: "Stop the turn" }));

  await waitFor(() => assert.equal(tool.mock.calls.length, 1));

  animations.length = 0;
  fireEvent.click(view.getByRole("button", { name: "Show composer" }));
  assertSingleStop();
  assert.equal(stopAnimations().length, 1);
  assert.equal(stopAnimations()[0].timing.duration, 180);

  assert.deepEqual(stopAnimations()[0].frames, [
    { transform: "translateY(-7px)" },
    { transform: "none" },
  ]);

  fireEvent.click(view.getByRole("button", { name: "Stop the turn" }));

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      ["interrupt_agent_task", { task_id: "task-1", send_pending: false }],
      ["interrupt_agent_task", { task_id: "task-1", send_pending: false }],
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

for (const pending_input of [
  undefined,
  { id: "permission", tool: "Bash", kind: "permission" as const, input: {} },
]) {
  test(`a hidden ${pending_input ? "permission" : "running"} composer keeps Stop available`, async () => {
    const { view, tool } = setup({
      status: pending_input ? "waiting" : "running",
      pending_input,
    });

    fireEvent.click(view.getByRole("button", { name: "Hide composer" }));

    expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
    assert.ok(view.getByRole("button", { name: "Show composer" }));

    fireEvent.click(view.getByRole("button", { name: "Stop the turn" }));

    await waitFor(() =>
      assert.deepEqual(sent(tool), [
        ["interrupt_agent_task", { task_id: "task-1", send_pending: false }],
      ]),
    );
  });
}

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

test("question toggles preserve the ordinary composer's hidden preference", () => {
  const { view, updateTask } = setup({ status: "running" });
  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));

  updateTask({ status: "waiting", pending_input: questionInput("request") });
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
    assert.deepEqual(sent(tool), [
      ["interrupt_agent_task", { task_id: "task-1", send_pending: false }],
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

test("the expanded question composer queues messages and each new request starts collapsed", async () => {
  const { tool, view, updateTask } = setup({ status: "running" });
  updateTask({ status: "waiting", pending_input: questionInput("first") });
  fireEvent.click(view.getByRole("button", { name: "Show composer" }));
  const composer = view.getByRole("textbox", { name: "Message" });
  fireEvent.change(composer, { target: { value: "Next, add tests" } });
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "send_user_agent_message",
        { task_id: "task-1", message: "Next, add tests", delivery: "queue" },
      ],
    ]),
  );

  await waitFor(() =>
    assert.equal((composer as HTMLTextAreaElement).value, ""),
  );

  updateTask({ status: "waiting", pending_input: questionInput("second") });
  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();
  assert.ok(view.getByRole("button", { name: "Show composer" }));
});

test("pending steers can be sent now, and a paused queue resumed, cleared, edited and trimmed", async () => {
  const { tool, view } = setup({
    status: "running",
    pending_steers: [{ id: "msg_p", message: "Pending", from: "user" }],
    queue: [
      { id: "msg_q", message: "Queued", from: "user", delivery: "queue" },
      {
        id: "msg_l",
        message: "Left over",
        from: "parent",
        delivery: "steer",
        recorded: true,
      },
    ],
    queue_paused: true,
  });

  assert.ok(view.getByText("Steer"));
  assert.ok(view.getByText("Queue paused · 2"));
  // A steer the worker already has keeps its text.
  assert.equal(view.getAllByRole("button", { name: "Edit" }).length, 1);

  const click = async (name: string, index = 0) => {
    const count = tool.mock.calls.length;
    fireEvent.click(view.getAllByRole("button", { name })[index]);
    await waitFor(() => assert.equal(tool.mock.calls.length, count + 1));
  };

  await click("Interrupt and send now");
  await click("Resume");
  await click("Clear");
  await click("Remove", 1);

  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  const edit = view.getByRole("textbox", { name: "Queued message" });
  fireEvent.change(edit, { target: { value: "Edited" } });
  await click("Save");

  assert.deepEqual(sent(tool), [
    ["interrupt_agent_task", { task_id: "task-1", send_pending: true }],
    ["resume_user_agent_queue", { task_id: "task-1" }],
    ["clear_user_agent_queue", { task_id: "task-1" }],
    [
      "remove_user_agent_queued_message",
      { task_id: "task-1", message_id: "msg_l" },
    ],
    [
      "edit_user_agent_queued_message",
      { task_id: "task-1", message_id: "msg_q", message: "Edited" },
    ],
  ]);
});

test("queued messages reorder by dragging or Alt+arrows, behind a left-over steer", async () => {
  const queued = (id: string, message: string) => ({
    id,
    message,
    from: "user" as const,
    delivery: "queue" as const,
  });

  const { tool, view } = setup({
    status: "running",
    queue: [
      { ...queued("msg_l", "Left over"), delivery: "steer", recorded: true },
      queued("msg_a", "A"),
      queued("msg_b", "B"),
      queued("msg_c", "C"),
    ],
  });

  const row = (id: string) =>
    view.container.querySelector<HTMLElement>(`[data-message="${id}"]`)!;

  // The left-over steer can't move, so its grip slot stays empty.
  assert.equal(row("msg_l").getAttribute("draggable"), "false");
  assert.equal(row("msg_a").getAttribute("draggable"), "true");
  expect(row("msg_l").querySelector(".chat-queue-grip svg")).toBeNull();
  expect(row("msg_a").querySelector(".chat-queue-grip svg")).toBeTruthy();

  const moved = async (count: number) =>
    waitFor(() => assert.equal(tool.mock.calls.length, count));

  // At the top of the movable rows, Alt+Up does nothing.
  fireEvent.keyDown(row("msg_a"), { key: "ArrowUp", altKey: true });
  fireEvent.keyDown(row("msg_a"), { key: "ArrowDown" });
  fireEvent.keyDown(row("msg_a"), { key: "ArrowDown", altKey: true });
  await moved(1);

  // Dropping C over the lower half of the steer lands it first after it.
  const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
  fireEvent.dragStart(row("msg_c"), { dataTransfer });
  assert.ok(row("msg_c").hasAttribute("data-dragging"));
  fireEvent.dragOver(row("msg_l"), { clientY: 100 });
  assert.equal(row("msg_a").dataset.drop, "before");
  fireEvent.drop(row("msg_a"));
  await moved(2);

  // Dropping a row where it already is sends nothing.
  fireEvent.dragStart(row("msg_b"), { dataTransfer });
  fireEvent.dragOver(row("msg_b"), { clientY: 0 });
  fireEvent.drop(row("msg_b"));
  fireEvent.dragEnd(row("msg_b"));
  expect(view.container.querySelector("[data-drop]")).toBeNull();

  assert.deepEqual(sent(tool), [
    [
      "move_user_agent_queued_message",
      { task_id: "task-1", message_id: "msg_a", index: 2 },
    ],
    [
      "move_user_agent_queued_message",
      { task_id: "task-1", message_id: "msg_c", index: 1 },
    ],
  ]);
});

test("a spent budget shows its amounts and applies the raised limit", async () => {
  const { tool, view, updateTask, composer } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  assert.match(view.container.textContent ?? "", /\$5\.02 of \$5\.00 used/);
  expect(view.getByText("Cost limit reached")).toBeTruthy();

  assert.equal(
    view.container.querySelector(".chat-budget-limit-input > span")
      ?.textContent,
    "$",
  );

  const notice = view.container.querySelector(
    '[data-chat-item="budget-limit-task-1"]',
  );

  const apply = view.getByRole("button", { name: "Apply" });
  const limit = view.getByRole("spinbutton", { name: "Cost limit" });
  const limitSwitch = view.getByRole("switch", { name: "Cost limit" });
  assert.ok(notice?.contains(limit));
  expect(limit.closest(".chat-composer")).toBeNull();
  assert.equal((limit as HTMLInputElement).value, "5");
  assert.equal(limit.getAttribute("max"), null);
  expect(view.getByText("Apply a higher cost limit to continue.")).toBeTruthy();
  assert.equal((apply as HTMLButtonElement).disabled, true);
  assert.equal(view.getByText("Enabled").textContent, "Enabled");

  fireEvent.click(limitSwitch);
  assert.equal((limit as HTMLInputElement).disabled, true);
  assert.equal(view.getByText("Disabled").textContent, "Disabled");
  assert.equal((apply as HTMLButtonElement).disabled, false);

  fireEvent.click(limitSwitch);
  assert.equal((limit as HTMLInputElement).disabled, false);
  assert.equal((apply as HTMLButtonElement).disabled, true);

  fireEvent.change(limit, { target: { value: "8" } });
  assert.equal((apply as HTMLButtonElement).disabled, false);
  fireEvent.click(apply);

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "raise_user_agent_budget",
        { task_id: "task-1", budget: { max_cost_usd: 8 } },
      ],
    ]),
  );

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8 },
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  await waitFor(() => {
    assert.equal((composer as HTMLTextAreaElement).value, "Continue");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });

  expect(view.queryByText("Cost limit reached")).toBeNull();

  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "raise_user_agent_budget",
        {
          task_id: "task-1",
          budget: { max_cost_usd: 8 },
        },
      ],
      [
        "send_user_agent_message",
        {
          task_id: "task-1",
          message: "Continue",
          delivery: "steer",
        },
      ],
    ]),
  );
});

test("runtime limit uses the cost control pattern and accepts a higher limit", async () => {
  const { tool, view, composer, type, updateTask } = setup({
    status: "failed",
    error: "Runtime budget exhausted",
    budget: { ...base.budget, max_cost_usd: null },
    runtime_ms: 22 * 60_000,
    cost_usd: 0.44,
  });

  expect(view.getByText("Runtime limit reached")).toBeTruthy();
  expect(view.getByText("22 of 20 mins used")).toBeTruthy();

  assert.equal(
    view.container.querySelector(".chat-budget-limit-input > span")
      ?.textContent,
    "min",
  );

  expect(
    view.getByText("Apply a higher runtime limit to continue."),
  ).toBeTruthy();

  expect(view.queryByText("Max 120 min")).toBeNull();
  expect(view.queryByText("Runtime limit (minutes)")).toBeNull();

  const apply = view.getByRole("button", { name: "Apply" });

  type("Keep this draft");

  const limit = view.getByRole("spinbutton", {
    name: "Runtime limit (minutes)",
  });

  assert.ok(
    view.container
      .querySelector('[data-chat-item="budget-limit-task-1"]')
      ?.contains(limit),
  );

  expect(limit.closest(".chat-composer")).toBeNull();
  assert.equal(limit.getAttribute("max"), null);
  assert.equal((limit as HTMLInputElement).value, "20");

  assert.equal((apply as HTMLButtonElement).disabled, true);
  const limitSwitch = view.getByRole("switch", { name: "Runtime limit" });
  assert.equal(view.getByText("Enabled").textContent, "Enabled");
  fireEvent.click(limitSwitch);
  assert.equal((limit as HTMLInputElement).disabled, true);
  assert.equal(view.getByText("Disabled").textContent, "Disabled");
  assert.equal((apply as HTMLButtonElement).disabled, false);

  fireEvent.click(limitSwitch);
  assert.equal((limit as HTMLInputElement).disabled, false);
  assert.equal(view.getByText("Enabled").textContent, "Enabled");
  assert.equal((apply as HTMLButtonElement).disabled, true);

  fireEvent.change(limit, { target: { value: "121" } });

  expect(view.queryByRole("alert")).toBeNull();

  assert.equal((apply as HTMLButtonElement).disabled, false);
  fireEvent.click(apply);

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "raise_user_agent_budget",
        { task_id: "task-1", budget: { max_runtime_minutes: 121 } },
      ],
    ]),
  );

  updateTask({
    budget: { ...base.budget, max_runtime_minutes: 121, max_cost_usd: null },
    budget_raised_for_turn: { turn: 1, runtime: true },
  });

  await waitFor(() => {
    assert.equal((composer as HTMLTextAreaElement).value, "Keep this draft");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});

test("combined budget notice prompts after both spent dimensions are raised", async () => {
  const { tool, view, composer, updateTask } = setup({
    status: "failed",
    error: "Cost and runtime budget exhausted",
    cost_usd: 5.02,
    runtime_ms: 22 * 60_000,
  });

  expect(
    view.getByText("Apply higher cost and runtime limits to continue."),
  ).toBeTruthy();

  const cost = view.getByRole("spinbutton", { name: "Cost limit" });
  fireEvent.change(cost, { target: { value: "8" } });

  fireEvent.click(
    view
      .getByRole("group", { name: "Raise cost limit" })
      .querySelector(".chat-budget-apply")!,
  );

  await waitFor(() => assert.equal(sent(tool).length, 1));

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8 },
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  assert.equal((composer as HTMLTextAreaElement).value, "");
  expect(view.queryByRole("tooltip")).toBeNull();
  expect(view.getByText("Runtime limit reached")).toBeTruthy();

  const runtime = view.getByRole("spinbutton", {
    name: "Runtime limit (minutes)",
  });

  fireEvent.change(runtime, { target: { value: "24" } });

  fireEvent.click(
    view
      .getByRole("group", { name: "Raise runtime limit" })
      .querySelector(".chat-budget-apply")!,
  );

  await waitFor(() => assert.equal(sent(tool).length, 2));

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8, max_runtime_minutes: 24 },
    budget_raised_for_turn: { turn: 1, cost: true, runtime: true },
  });

  await waitFor(() => {
    assert.equal((composer as HTMLTextAreaElement).value, "Continue");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});

test("a limit below the current budget shows validation feedback", () => {
  const { view } = setup({
    status: "failed",
    error: "Runtime budget exhausted",
    budget: { ...base.budget, max_cost_usd: null },
    runtime_ms: 22 * 60_000,
    cost_usd: 0.44,
  });

  const apply = view.getByRole("button", { name: "Apply" });

  const limit = view.getByRole("spinbutton", {
    name: "Runtime limit (minutes)",
  });

  fireEvent.change(limit, { target: { value: "19" } });

  const validationError = view.getByRole("alert");

  assert.equal(
    validationError.textContent,
    "Enter a limit higher than 20 mins.",
  );

  assert.equal(limit.getAttribute("aria-invalid"), "true");
  assert.equal((apply as HTMLButtonElement).disabled, true);

  fireEvent.change(limit, { target: { value: "21" } });
  expect(view.queryByRole("alert")).toBeNull();
});

test("a cost limit below the current budget shows validation feedback", () => {
  const { view } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  const apply = view.getByRole("button", { name: "Apply" });
  const limit = view.getByRole("spinbutton", { name: "Cost limit" });

  fireEvent.change(limit, { target: { value: "4" } });

  const validationError = view.getByRole("alert");

  assert.equal(validationError.textContent, "Enter a limit higher than $5.00.");

  assert.equal(limit.getAttribute("aria-invalid"), "true");
  assert.equal((apply as HTMLButtonElement).disabled, true);

  fireEvent.change(limit, { target: { value: "8" } });
  expect(view.queryByRole("alert")).toBeNull();
});

test("budget controls lock while a limit update is in flight", async () => {
  const { tool, view, composer, updateTask } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  let finishUpdate!: (value: unknown) => void;

  tool.mockImplementationOnce(
    () => new Promise((resolve) => (finishUpdate = resolve)),
  );

  const limit = view.getByRole("spinbutton", { name: "Cost limit" });
  const limitSwitch = view.getByRole("switch", { name: "Cost limit" });

  fireEvent.change(limit, { target: { value: "8" } });
  fireEvent.click(view.getByRole("button", { name: "Apply" }));

  expect((limit as HTMLInputElement).disabled).toBe(true);
  expect(limitSwitch.hasAttribute("data-disabled")).toBe(true);
  assert.equal((composer as HTMLTextAreaElement).value, "");
  expect(view.queryByRole("tooltip")).toBeNull();

  finishUpdate({});

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8 },
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  await waitFor(() => {
    expect(view.queryByRole("spinbutton", { name: "Cost limit" })).toBeNull();
    expect(view.queryByRole("switch", { name: "Cost limit" })).toBeNull();
    assert.equal((composer as HTMLTextAreaElement).value, "Continue");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});

test("a failed limit update does not prompt to continue", async () => {
  const { tool, view, composer } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  tool.mockRejectedValueOnce(new Error("Could not update the limit"));

  fireEvent.change(view.getByRole("spinbutton", { name: "Cost limit" }), {
    target: { value: "8" },
  });

  fireEvent.click(view.getByRole("button", { name: "Apply" }));

  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toBe(
      "Could not update the limit",
    ),
  );

  assert.equal((composer as HTMLTextAreaElement).value, "");
  expect(view.queryByRole("tooltip")).toBeNull();
});

test("a successful limit update opens and focuses a collapsed composer", async () => {
  const { tool, view, updateTask } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));
  expect(view.queryByRole("textbox", { name: "Message" })).toBeNull();

  fireEvent.change(view.getByRole("spinbutton", { name: "Cost limit" }), {
    target: { value: "8" },
  });

  fireEvent.click(view.getByRole("button", { name: "Apply" }));

  await waitFor(() => assert.equal(sent(tool).length, 1));

  updateTask({
    budget: { ...base.budget, max_cost_usd: 8 },
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  await waitFor(() => {
    const composer = view.getByRole("textbox", { name: "Message" });
    assert.equal((composer as HTMLTextAreaElement).value, "Continue");
    assert.equal(document.activeElement, composer);

    expect(view.getByRole("tooltip").textContent).toBe(
      "Press ENTER to continue",
    );
  });
});

test("a failed send keeps the draft and shows why", async () => {
  const { tool, composer, type, view } = setup();
  tool.mockRejectedValueOnce(new Error("The task is being deleted"));
  type("Keep me");
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.equal(
      view.getByRole("alert").textContent,
      "The task is being deleted",
    ),
  );

  assert.equal((composer as HTMLTextAreaElement).value, "Keep me");
});
