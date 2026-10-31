// @vitest-environment jsdom
import { expect } from "vitest";

import { LOADING_SKELETON_CONFIG } from "../../src/panel/shared/components/loading-skeleton/loading-skeleton-config";
import { MOTION } from "../../src/panel/shared/components/motion/motion-utils";
import {
  act,
  assert,
  assertAbsent,
  describe,
  openAdvancedTask,
  pasteText,
  screen,
  setup,
  setupInspector,
  task,
  test,
  vi,
  within,
} from "./panel-test-support";

test("the inspector omits task descriptions across refresh and task selection", async (t) => {
  const literal =
    '<img src=x onerror="window.injected=true">\nFull worker instructions.';

  const { controller, transport, user } = await setupInspector(
    t,
    (transport) => {
      const [current] = transport.tasks;

      assert.ok(current);
      current.description = literal;

      transport.tasks.push({
        ...task("two"),
        title: "Second task",
        description: "Second instructions",
      });
    },
  );

  const header = () => document.querySelector(".task-header")!;

  assert.ok(!header().textContent?.includes(literal));
  assertAbsent(header().querySelector(".notice, img"));

  const [listed] = transport.tasks;

  assert.ok(listed);
  transport.tasks[0] = { ...listed, description: literal + " Updated." };

  await act(() => controller.refresh());
  assert.ok(!header().textContent?.includes("Full worker instructions"));
  await act(() => controller.select("two"));

  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    "Second task",
  );

  assert.ok(!header().textContent?.includes("Second instructions"));
  await user.click(screen.getByRole("tab", { name: "Details" }));
  // Activity keeps its hidden panel mounted with the initial request, so scope to Details.
  const details = () => within(screen.getByRole("tabpanel"));
  assert.ok(details().getByText("Second instructions").closest("dd"));
  await act(() => controller.select("one"));
  await user.click(screen.getByRole("tab", { name: "Details" }));

  const description = details().getByText(literal + " Updated.", {
    normalizer: (text) => text,
  });

  assert.ok(description.closest("dd"));
  assertAbsent(description.querySelector("img"));
});

test("inline preview expands and collapses while preserving the selected task", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      const second = task("two");
      second.title = "Review database";
      transport.tasks.push(second);
    },
    { displayMode: "inline" },
  );

  await act(() => controller.select("two"));
  assert.ok(screen.getByText("Review database"));
  assert.ok(screen.getByText("Running", { exact: true }));
  assertAbsent(screen.queryByRole("button", { name: "New task" }));
  assertAbsent(screen.queryByRole("region", { name: "Selected task" }));

  assertAbsent(
    screen.queryByRole("complementary", { name: "Delegated tasks" }),
  );

  await user.click(screen.getByRole("button", { name: "Open panel" }));
  assert.equal(transport.expandCalls, 1);
  assert.equal(controller.getSnapshot().selected, "two");
  assert.ok(screen.getByRole("button", { name: "New task" }));

  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    "Review database",
  );

  await user.click(screen.getByRole("button", { name: "Collapse" }));
  assert.equal(transport.expandCalls, 2);
  assert.equal(controller.getSnapshot().selected, "two");
  assert.ok(screen.getByText("Review database"));
  assert.ok(screen.getByRole("button", { name: "Open panel" }));
  assertAbsent(screen.queryByRole("region", { name: "Selected task" }));
});

test("inline host without expansion offers the chat controls fallback", async (t) => {
  await setup(
    t,
    (transport) => {
      transport.host.canExpand = false;
    },
    { displayMode: "inline" },
  );

  assertAbsent(screen.queryByRole("button", { name: "Open panel" }));
  assert.ok(screen.getByText("Expand this app using the chat controls."));
  assertAbsent(screen.queryByRole("button", { name: "New task" }));
});

test("failed expansion keeps the inline preview and displays the host error", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      transport.expand = async () => {
        transport.expandCalls++;
        throw new Error("Panel expansion unavailable");
      };
    },
    { displayMode: "inline" },
  );

  await user.click(screen.getByRole("button", { name: "Open panel" }));
  await screen.findByRole("alert");

  assert.equal(
    screen.getByRole("alert").textContent,
    "Panel expansion unavailable",
  );

  assert.equal(transport.expandCalls, 1);
  assert.equal(controller.getSnapshot().host.displayMode, "inline");
  assert.ok(screen.getByRole("button", { name: "Open panel" }));
  assertAbsent(screen.queryByRole("region", { name: "Selected task" }));
});

test("host collapse preserves a delegation draft until scope changes", async (t) => {
  const { controller, transport, user } = await setup(t);
  await openAdvancedTask(user);
  const field = await screen.findByLabelText("Description");
  await pasteText(user, field, "Preserve this suspended draft");
  const dialogState = controller.getSnapshot().dialog;
  await act(() => transport.expand());
  assert.ok(screen.getByRole("region", { name: "Delegated Work preview" }));
  assertAbsent(screen.queryByRole("dialog"));
  assert.ok(controller.getSnapshot().dialog === dialogState);
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  await screen.findByRole("dialog");

  expect(
    screen.getByLabelText("Description"),
    "Host expansion retains the draft field node",
  ).toBe(field);

  assert.equal(
    (field as HTMLTextAreaElement).value,
    "Preserve this suspended draft",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );

  await act(() => transport.expand());
  assertAbsent(screen.queryByRole("dialog"));
  await act(() => controller.changeProject("/repo/b"));
  assert.equal(controller.getSnapshot().dialog, undefined);
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  assertAbsent(screen.queryByRole("dialog"));
  await openAdvancedTask(user);
  await screen.findByRole("dialog");

  assert.equal(
    screen.getByLabelText<HTMLTextAreaElement>("Description").value,
    "",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );
});

describe("nonembedded panels retain the full interface in inline mode", () => {
  test("nonembedded panel", async (t) => {
    await setup(
      t,
      (transport) => {
        transport.embedded = false;
      },
      { displayMode: "inline" },
    );

    assert.ok(screen.getByRole("button", { name: "New task" }));
    assert.ok(screen.getByRole("region", { name: "Selected task" }));
    assertAbsent(screen.queryByRole("button", { name: "Open panel" }));
  });
});

test("inline preview renders refresh errors without exposing the full interface", async (t) => {
  const { controller } = await setup(t, undefined, { displayMode: "inline" });
  await act(async () => controller.report(new Error("Refresh unavailable")));
  assert.equal(screen.getByRole("alert").textContent, "Refresh unavailable");
  assert.ok(screen.getByText("Review authentication"));
  assert.ok(screen.getByRole("button", { name: "Open panel" }));
  assertAbsent(screen.queryByRole("region", { name: "Selected task" }));
});

test("inline preview summarizes repository scope independently of list filters", async (t) => {
  const { controller } = await setup(
    t,
    (transport) => {
      const waiting = task("waiting");
      waiting.title = "Waiting review";
      waiting.status = "waiting";

      waiting.pending_input = {
        id: "request",
        tool: "AskUserQuestion",
        kind: "question",
        input: {},
      };

      const stopped = task("stopped");
      stopped.status = "failed";
      const complete = task("complete");
      complete.status = "completed";

      transport.tasks.push(
        waiting,
        stopped,
        complete,
        task("other", "/repo/b"),
      );
    },
    { displayMode: "inline", scoped: true },
  );

  await act(async () => {
    controller.setFilter("completed");
    controller.setSearch("no matching task");
  });

  assert.equal(
    screen.getByRole("status").textContent,
    "4 tasks · 2 active · 1 needing attention",
  );

  assert.ok(screen.getByText("Waiting review"));
  assert.ok(screen.getByText("Needs input", { exact: true }));
  assertAbsent(screen.queryByRole("region", { name: "Selected task" }));
});

describe("inline preview distinguishes empty tasks from connecting state", () => {
  test("empty", async (t) => {
    await setup(
      t,
      (transport) => {
        transport.tasks = [];
      },
      { displayMode: "inline" },
    );

    assert.equal(
      screen.getByRole("status").textContent,
      "0 tasks · 0 active · 0 needing attention",
    );

    assert.ok(screen.getByText("No delegated tasks yet."));
    assert.ok(screen.getByRole("button", { name: "Open panel" }));
  });

  test("connecting", async (t) => {
    vi.useFakeTimers();

    try {
      const { controller } = await setup(t, undefined, { start: false });

      assert.ok(screen.getByRole("region", { name: "Delegated Work preview" }));

      await act(() => vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.delay));

      assert.ok(
        screen.getByRole("status", { name: "Loading delegated tasks" }),
      );

      assertAbsent(screen.queryByText("No delegated tasks yet."));
      assertAbsent(screen.queryByRole("button", { name: "New task" }));

      await act(async () => controller.showHostRequired());

      await act(() =>
        vi.advanceTimersByTime(
          LOADING_SKELETON_CONFIG.minimumVisible + MOTION.loadingCrossfade,
        ),
      );

      assert.equal(screen.getByRole("status").textContent, "Open through MCP");
    } finally {
      vi.useRealTimers();
    }
  });
});

test("long notices clamp behind Show more and expand on demand", async (t) => {
  // jsdom has no layout, so report clamped notice text as overflowing.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".notice-text:not([data-open])") ? 80 : 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".notice-text") ? 36 : 0;
    },
  );

  const { user } = await setupInspector(t, (transport) => {
    const [current] = transport.tasks;

    assert.ok(current);
    current.status = "waiting";

    current.pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: { description: "Please clarify the request. ".repeat(20) },
    };
  });

  const more = screen.getByRole("button", { name: "Show more" });
  assert.equal(more.getAttribute("aria-expanded"), "false");
  await user.click(more);
  const less = screen.getByRole("button", { name: "Show less" });
  assert.equal(less.getAttribute("aria-expanded"), "true");
  assert.ok(document.querySelector(".notice-text[data-open]"));
  await user.click(less);
  assert.ok(screen.getByRole("button", { name: "Show more" }));
  assertAbsent(document.querySelector(".notice-text[data-open]"));
});

test("the inspector stacks when its fixed header would squeeze the evidence", async (t) => {
  t.onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const notify: (() => void)[] = [];

  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notify.push(() => callback([], this as unknown as ResizeObserver));
      }

      observe() {}
      disconnect() {}
    },
  );

  let height = 600;

  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.id === "detail" ? height : 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".task-header") ? 300 : 0;
    },
  );

  await setupInspector(t);
  const detail = screen.getByRole("region", { name: "Selected task" });
  assert.equal(detail.hasAttribute("data-stacked"), false, "300px is enough");
  height = 560;
  act(() => notify.forEach((callback) => callback()));
  assert.equal(detail.hasAttribute("data-stacked"), true, "260px is not");
});

test("refresh preserves the inspector and its scroll, while Back stays on the task list", async (t) => {
  const { controller, user } = await setup(t);
  const detail = screen.getByRole("region", { name: "Selected task" });
  const header = detail.querySelector(".task-header");
  detail.scrollTop = 160;
  await act(() => controller.refresh());

  expect(screen.getByRole("region", { name: "Selected task" })).toBe(detail);
  expect(detail.querySelector(".task-header")).toBe(header);
  assert.equal(detail.scrollTop, 160);
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  await act(() => controller.refresh());
  assert.equal(controller.getSnapshot().selected, undefined);
  assertAbsent(detail.querySelector(".task-header"));
});

test("narrow scoped panel Back keeps the task list visible across refresh", async (t) => {
  const { controller, user } = await setup(t, undefined, {
    wide: false,
    scoped: true,
  });

  assert.equal(document.body.dataset.selected, "true");
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  assert.equal(document.body.dataset.selected, "false");
  await act(() => controller.refresh());
  assert.equal(document.body.dataset.selected, "false");
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.ok(screen.getByRole("complementary", { name: "Delegated tasks" }));
});
