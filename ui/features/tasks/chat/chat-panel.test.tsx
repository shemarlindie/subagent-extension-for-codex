// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { onTestFinished, test, vi } from "vitest";

import { previewEvents } from "../../../dev/preview/fixtures";
import { Controller } from "../../../shared/state/controller";
import { ControllerContext } from "../../../shared/state/controller-context";
import type { Event, Task, Transport } from "../../../shared/state/types";
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

function setup(patch: Partial<Task> = {}, events: Event[] = []) {
  onTestFinished(cleanup);
  const task = { ...base, ...patch };

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());
  const tool = vi.spyOn(controller, "tool").mockResolvedValue({});
  vi.spyOn(controller, "refresh").mockResolvedValue();
  const snapshot = { ...controller.getSnapshot(), events };
  vi.spyOn(controller, "getSnapshot").mockReturnValue(snapshot);

  const panel = (current: Task) => (
    <ControllerContext.Provider value={controller}>
      <ChatPanel task={current} />
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

test("dependency waiting shows a paused status instead of the running indicator", () => {
  const { view } = setup({
    status: "waiting",
    waiting_reason: "waiting_for_dependency",
  });

  const status = view.getByRole("status");

  assert.equal(status.textContent, "Waiting on dependency");
  assert.ok(status.querySelector(".row-status-icon.waiting"));
  assert.equal(status.querySelector(".running"), null);

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
    assert.equal(status.querySelector(".running"), null);
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
  assert.equal(view.queryByRole("button", { name: "Steer" }), null);
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
  assert.equal(view.container.querySelector(".chat-composer"), composer);
  assert.equal(composer?.querySelector(".chat-composer-toggle-row"), null);
  assert.ok(composer?.querySelector(".chat-composer-body"));

  const [expansion] = composerAnimations();

  assert.equal(composerAnimations().length, 1);
  assert.equal(expansion.element, composer);

  assert.deepEqual(
    expansion.frames.map((frame) => frame.height),
    ["28px", "64px"],
  );

  act(() => expansion.animation.onfinish?.());
  animations.length = 0;

  fireEvent.click(view.getByRole("button", { name: "Hide composer" }));
  assert.equal(view.container.querySelector(".chat-composer"), composer);
  assert.ok(composer?.querySelector(".chat-composer-toggle-row"));
  assert.equal(composer?.querySelector(".chat-composer-body"), null);

  const [collapse] = composerAnimations();

  assert.equal(composerAnimations().length, 1);
  assert.equal(collapse.element, composer);

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

  assert.equal(view.queryByRole("textbox", { name: "Message" }), null);
  assert.equal(view.queryByRole("button", { name: "Stop the turn" }), null);

  fireEvent.click(view.getByRole("button", { name: "Show composer (draft)" }));

  const composer = view.getByRole("textbox", { name: "Message" });

  assert.equal(
    (composer as HTMLTextAreaElement).value,
    "Keep the next turn draft",
  );

  assert.equal(document.activeElement, composer);
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

    assert.equal(view.queryByRole("textbox", { name: "Message" }), null);
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
  assert.equal(view.queryByRole("textbox", { name: "Message" }), null);

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
  assert.equal(view.queryByRole("textbox", { name: "Message" }), null);
  assert.ok(view.getByRole("button", { name: "Show composer" }));
});

test("questions collapse the composer while preserving its draft and Stop action", async () => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  onTestFinished(() => focus.mockRestore());
  const { tool, view, type, updateTask } = setup({ status: "running" });
  type("Keep this draft");
  updateTask({ status: "waiting", pending_input: questionInput("request") });

  assert.equal(view.queryByRole("textbox", { name: "Message" }), null);
  assert.equal(view.queryByText(/Enter to queue/), null);

  const show = view.getByRole("button", { name: "Show composer (draft)" });

  const controlled = document.getElementById(
    show.getAttribute("aria-controls")!,
  );

  assert.ok(controlled);
  fireEvent.click(show);

  const composer = view.getByRole("textbox", { name: "Message" });

  assert.equal(document.activeElement, composer);
  assert.equal(focus.mock.instances.at(-1), composer);
  assert.deepEqual(focus.mock.lastCall, [{ preventScroll: true }]);
  assert.equal((composer as HTMLTextAreaElement).value, "Keep this draft");
  const collapse = view.getByRole("button", { name: "Hide composer" });
  const composerBox = composer.closest(".chat-composer-box");

  assert.equal(
    document.getElementById(collapse.getAttribute("aria-controls")!),
    controlled,
  );

  assert.equal(collapse.closest(".chat-composer-box"), null);
  assert.equal(collapse.parentElement, composerBox?.parentElement);

  assert.ok(
    collapse.compareDocumentPosition(composer) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );

  assert.equal(collapse.textContent, "");
  fireEvent.change(composer, { target: { value: "After the answer" } });
  fireEvent.click(collapse);
  assert.equal(view.queryByRole("textbox", { name: "Message" }), null);

  assert.equal(
    document.activeElement,
    view.getByRole("button", { name: "Show composer (draft)" }),
  );

  assert.equal(
    document.getElementById(
      document.activeElement!.getAttribute("aria-controls")!,
    ),
    controlled,
  );

  assert.equal(focus.mock.instances.at(-1), document.activeElement);
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
  assert.equal(view.queryByRole("textbox", { name: "Message" }), null);
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

  assert.ok(view.getByText("Sent after the next tool call"));
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

test("a spent budget shows its amounts, and the next message raises it", async () => {
  const { tool, composer, type, view } = setup({
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    cost_usd: 5.02,
  });

  assert.match(view.container.textContent ?? "", /Used \$5\.02 of \$5\.00/);

  fireEvent.change(view.getByRole("spinbutton", { name: "Cost limit ($)" }), {
    target: { value: "8" },
  });

  type("Carry on");
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() =>
    assert.deepEqual(sent(tool), [
      [
        "send_user_agent_message",
        {
          task_id: "task-1",
          message: "Carry on",
          delivery: "steer",
          budget: { max_cost_usd: 8 },
        },
      ],
    ]),
  );
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
