// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { expandedJson } from "../../../shared/components/json-tree/json-tree-test-harness";
import {
  controlledElement,
  getElement,
} from "../../../shared/utils/dom-test-harness";
import {
  assertAbsent,
  event,
  parseHtml,
  stubProperty,
  tooltipText,
} from "./activity-ui-test-harness";
import {
  EventDetails as EventList,
  EventList as GroupedEventList,
} from "./event-list";

test("opening event data shows the recorded JSON and preserves disclosure through refresh", async (t) => {
  t.onTestFinished(cleanup);

  const raw = {
    type: "assistant",
    uuid: "raw-message-id",
    message: { content: [{ type: "text", text: "Hello <script>" }] },
    usage: { input_tokens: 0 },
    future_field: false,
  };

  const activity = event("agent.message", { text: "Hello", raw_response: raw });
  const view = render(createElement(EventList, { events: [activity] }));

  const details = view.container.querySelector(
    "details.activity-raw",
  ) as HTMLDetailsElement;

  assert.equal(details.open, false);
  assertAbsent(details.querySelector(".json-tree"));

  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });

  await waitFor(() =>
    assert.deepEqual(
      expandedJson(details),
      JSON.parse(JSON.stringify(activity.data)),
    ),
  );

  const message = view.getByRole("button", { name: "message" });
  fireEvent.click(message);

  view.rerender(createElement(EventList, { events: [{ ...activity }] }));
  expect(view.container.querySelector("details.activity-raw")).toBe(details);
  assert.equal(details.open, true);

  expect(view.getByRole("button", { name: "message" })).toBe(message);

  expect(message.getAttribute("aria-expanded")).toBe("false");
  expect(details.textContent).not.toContain("Hello <script>");

  assertAbsent(view.container.querySelector("script"));

  await act(async () => {
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });

  await waitFor(() => assertAbsent(details.querySelector(".json-tree")));
});

test("unknown events expose their entire data when no raw response exists", async (t) => {
  t.onTestFinished(cleanup);

  const data = {
    text: "Opaque event",
    enabled: false,
    count: 0,
    nested: [null],
  };

  const view = render(
    createElement(EventList, { events: [event("vendor.future_event", data)] }),
  );

  const details = view.container.querySelector(
    "details.activity-raw",
  ) as HTMLDetailsElement;

  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });

  await waitFor(() => assert.deepEqual(expandedJson(details), data));
});

test("grouped tool activity retains individual raw inspections while progress refreshes", async (t) => {
  t.onTestFinished(cleanup);

  const rawStart = {
    type: "assistant",
    uuid: "start-wire",
    message: {
      content: [
        {
          type: "tool_use",
          id: "read",
          name: "Read",
          input: { file_path: "a.ts" },
        },
      ],
    },
  };

  const started = event(
    "tool.started",
    {
      id: "read",
      name: "Read",
      input: { file_path: "a.ts" },
      raw_response: rawStart,
    },
    "group-start",
  );

  const progress = event(
    "claude.activity",
    {
      type: "tool_progress",
      tool_use_id: "read",
      tool_name: "Read",
      elapsed_time_seconds: 1,
    },
    "group-progress",
  );

  const view = render(
    createElement(GroupedEventList, { events: [started, progress] }),
  );

  const groups = view.container.querySelectorAll(".activity-group");
  assert.equal(groups.length, 1);
  const debug = view.getByRole("button", { name: "Debug activity: Read" });
  assert.equal(debug.getAttribute("aria-expanded"), "false");
  fireEvent.click(debug);
  assert.equal(debug.getAttribute("aria-expanded"), "true");

  const raw = Array.from(
    view.container.querySelectorAll("details.activity-raw"),
  ).at(-1) as HTMLDetailsElement;

  assert.ok(raw, "Grouped events retain per-response raw details");

  await act(async () => {
    raw.open = true;
    raw.dispatchEvent(new Event("toggle"));
  });

  await waitFor(() =>
    assert.deepEqual(
      expandedJson(raw),
      JSON.parse(JSON.stringify(started.data)),
    ),
  );

  const completed = event(
    "tool.completed",
    {
      id: "read",
      error: false,
      content: "File contents",
      raw_response: { type: "user", uuid: "result-wire" },
    },
    "group-completed",
  );

  view.rerender(
    createElement(GroupedEventList, { events: [started, progress, completed] }),
  );

  assert.equal(view.container.querySelectorAll(".activity-group").length, 1);

  assert.ok(
    raw.isConnected,
    "Stable group updates retain the open raw inspector",
  );

  assert.equal(raw.open, true);
  assert.equal(debug.getAttribute("aria-expanded"), "true");

  assert.deepEqual(expandedJson(raw), JSON.parse(JSON.stringify(started.data)));

  assert.equal(
    view.container.querySelectorAll("details.activity-raw").length,
    3,
  );
});

test("grouped streams accumulate readable blocks and preserve every frame for inspection", async (t) => {
  t.onTestFinished(cleanup);

  const frames = [
    { type: "message_start", message: { id: "stream-message" } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello " },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "world" },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "Checking " },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "evidence" },
    },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "read", name: "Read", input: {} },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"file_path":' },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '"a.ts"}' },
    },
    { type: "message_stop" },
  ];

  const events = frames.map((frame, i) =>
    event(
      "claude.activity",
      {
        type: "stream_event",
        parent_tool_use_id: null,
        event: frame,
        raw_response: { type: "stream_event", event: frame, uuid: `wire-${i}` },
      },
      `stream-accumulation-${i}`,
    ),
  );

  const html = renderToStaticMarkup(
    createElement(GroupedEventList, { events }),
  );

  const doc = parseHtml(html);
  assert.equal(doc.querySelectorAll(".activity-group").length, 1);
  const content = doc.querySelector(".activity-stream > .activity-body");
  assert.match(content?.textContent ?? "", /Hello world/);
  assert.match(content?.textContent ?? "", /Checking evidence/);
  assert.match(content?.textContent ?? "", /\{"file_path":"a.ts"\}/);
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 0);

  // Static markup has no tooltip, so count the frames on a live render.
  const live = render(createElement(GroupedEventList, { events }));

  assert.equal(
    await tooltipText(
      getElement(live.container, "button.activity-debug-toggle"),
    ),
    "Inspect 10 raw responses",
  );

  assert.equal(
    doc.querySelector(".activity-debug-panel")?.hasAttribute("hidden"),
    true,
  );
});

test("a final SDK message replaces provisional stream text with a response marker", () => {
  const events = [
    event(
      "claude.activity",
      {
        type: "stream_event",
        event: { type: "message_start", message: { id: "final-fold" } },
      },
      "final-fold-start",
    ),
    event(
      "claude.activity",
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Provisional" },
        },
      },
      "final-fold-delta",
    ),
    event(
      "agent.message",
      {
        text: "Final response",
        raw_response: {
          type: "assistant",
          message: {
            id: "final-fold",
            content: [{ type: "text", text: "Final response" }],
          },
        },
      },
      "final-fold-message",
    ),
  ];

  const doc = parseHtml(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  );

  assert.equal(doc.querySelectorAll(".activity-group").length, 1);

  assert.equal(
    doc.querySelector(".activity-group-secondary")?.textContent,
    "Started a response...",
  );

  assertAbsent(doc.querySelector(".activity-message > .activity-body"));
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 0);
});

test("a compact accessible debug toggle hides inspection until opened and preserves raw state", async (t) => {
  t.onTestFinished(cleanup);

  const activity = event(
    "agent.message",
    {
      text: "Readable worker update",
      raw_response: {
        type: "assistant",
        uuid: "debug-wire",
        message: {
          content: [{ type: "text", text: "Readable worker update" }],
        },
      },
    },
    "debug-message",
  );

  const view = render(createElement(GroupedEventList, { events: [activity] }));

  const toggle = view.getByRole("button", {
    name: "Debug activity: Assistant",
  });

  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await tooltipText(toggle), "Inspect 1 raw response");
  const panel = controlledElement(toggle);
  assert.equal(panel.hidden, true);
  assertAbsent(view.queryByText("Event data", { selector: "summary" }));
  const message = getElement(view.container, ".activity-message");

  assert.equal(
    message.querySelector(".activity-group-secondary")?.textContent,
    "Started a response...",
  );

  assertAbsent(
    message.querySelector(".activity-body"),
    "A text-only response has no bubble",
  );

  const outside = view.container.cloneNode(true) as HTMLElement;

  outside
    .querySelectorAll(".activity-debug-panel")
    .forEach((element) => element.remove());

  assert.ok(
    !/Inspect activity|Inspect response|Raw response/.test(
      outside.textContent ?? "",
    ),
  );

  act(() => toggle.focus());

  expect(
    document.activeElement,
    "Native debug button participates in keyboard focus",
  ).toBe(toggle);

  await userEvent.setup({ document: document }).keyboard("{Enter}");
  assert.equal(panel.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const raw = panel.querySelector("details.activity-raw") as HTMLDetailsElement;
  // The newest raw response opens automatically with the debug panel.
  assert.equal(raw.open, true);

  assert.deepEqual(
    expandedJson(raw),
    JSON.parse(JSON.stringify(activity.data)),
  );

  view.rerender(createElement(GroupedEventList, { events: [{ ...activity }] }));

  expect(
    view.getByRole("button", { name: "Debug activity: Assistant" }),
    "Debug toggle keeps its identity",
  ).toBe(toggle);

  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(raw.open, true);
  assert.equal(panel.hidden, false);
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  fireEvent.click(toggle);

  assert.equal(
    raw.open,
    true,
    "Closing the debug panel preserves individual raw disclosures",
  );

  assert.deepEqual(
    expandedJson(raw),
    JSON.parse(JSON.stringify(activity.data)),
  );

  await act(async () => {
    raw.open = false;
    raw.dispatchEvent(new Event("toggle"));
  });

  view.rerender(createElement(GroupedEventList, { events: [{ ...activity }] }));
  expect(panel.querySelector("details.activity-raw")).toBe(raw);
  assert.equal(raw.open, false, "A manual collapse survives a refresh");
  assertAbsent(raw.querySelector(".json-tree"));
});

test("opening debug scrolls its panel into view once the height transition settles", async (t) => {
  t.onTestFinished(cleanup);
  const scrolled: string[] = [];
  let reducedMotion = false;

  stubProperty(
    t,
    Element.prototype,
    "scrollIntoView",
    function (this: Element) {
      scrolled.push(this.id);
    },
  );

  stubProperty(t, window, "matchMedia", () => ({ matches: reducedMotion }));

  const read = event(
    "tool.started",
    { name: "Read", id: "reveal-read" },
    "reveal-read",
  );

  const view = render(createElement(GroupedEventList, { events: [read] }));
  const toggle = view.getByRole("button", { name: "Debug activity: Read" });
  const panel = controlledElement(toggle);

  fireEvent.click(toggle);

  // Child transitions and other properties bubble up but do not reveal the panel.
  fireEvent.transitionEnd(getElement(panel, ".activity-debug-caption"), {
    propertyName: "height",
  });

  fireEvent.transitionEnd(panel, { propertyName: "opacity" });
  // A reveal would scroll on a later frame, so give one time to land.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  assert.deepEqual(scrolled, []);

  fireEvent.transitionEnd(panel, { propertyName: "height" });
  // Compare ids: deep-equal on jsdom nodes walks the whole document graph.
  await waitFor(() => assert.deepEqual(scrolled, [panel.id]));

  cleanup();

  reducedMotion = true;
  const reduced = render(createElement(GroupedEventList, { events: [read] }));

  const reducedToggle = reduced.getByRole("button", {
    name: "Debug activity: Read",
  });

  scrolled.length = 0;
  fireEvent.click(reducedToggle);

  // Reduced motion has no height transition, so the panel is revealed without one.
  await waitFor(() =>
    assert.deepEqual(scrolled, [reducedToggle.getAttribute("aria-controls")]),
  );
});

test("operation failure messages remain visible outside collapsed debug details", () => {
  const events = [
    event(
      "claude.activity",
      {
        type: "system",
        subtype: "hook_started",
        hook_id: "hook",
        hook_name: "Checks",
      },
      "visible-hook-start",
    ),
    event(
      "claude.activity",
      {
        type: "system",
        subtype: "hook_response",
        hook_id: "hook",
        outcome: "error",
        stderr: "Visible hook stderr",
      },
      "visible-hook-failed",
    ),
    event(
      "tool.started",
      { id: "read", name: "Read", input: { file_path: "a.ts" } },
      "visible-tool-start",
    ),
    event(
      "tool.completed",
      {
        id: "read",
        error: true,
        content: [{ type: "text", text: "Visible tool error" }],
      },
      "visible-tool-failed",
    ),
  ];

  const doc = parseHtml(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  );

  assert.equal(
    doc.querySelectorAll(".activity-group.activity-error").length,
    2,
  );

  // activity-timeline's tests own the summary text. Here it renders outside Debug.
  doc
    .querySelectorAll(".activity-debug-panel")
    .forEach((node) => node.remove());

  assert.match(doc.body.textContent ?? "", /Visible hook stderr/);
  assert.match(doc.body.textContent ?? "", /Visible tool error/);
});

test("tool result image previews and individual responses mount on first debug activation", (t) => {
  t.onTestFinished(cleanup);

  const events = [
    event(
      "tool.started",
      { id: "image-tool", name: "Read", input: { file_path: "image.png" } },
      "lazy-image-start",
    ),
    event(
      "tool.completed",
      {
        id: "image-tool",
        error: false,
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "aGVsbG8=",
            },
          },
        ],
      },
      "lazy-image-result",
    ),
  ];

  const view = render(createElement(GroupedEventList, { events }));
  const toggle = view.getByRole("button", { name: "Debug activity: Read" });
  const panel = controlledElement(toggle);
  assert.equal(panel.hidden, true);
  assertAbsent(view.container.querySelector("img.activity-image"));

  assert.equal(
    view.container.querySelectorAll("details.activity-raw").length,
    0,
  );

  fireEvent.click(toggle);
  assert.equal(panel.hidden, false);
  const image = getElement(panel, "img.activity-image");
  assert.equal(image.getAttribute("src"), "data:image/png;base64,aGVsbG8=");

  assert.equal(
    panel.querySelectorAll("details.activity-raw").length,
    events.length,
  );

  fireEvent.click(toggle);
  assert.equal(panel.hidden, true);
  expect(panel.querySelector("img.activity-image")).toBe(image);
  view.rerender(createElement(GroupedEventList, { events: [...events] }));
  assert.equal(panel.hidden, true);
  expect(panel.querySelector("img.activity-image")).toBe(image);
  fireEvent.click(toggle);
  assert.equal(panel.hidden, false);
  expect(panel.querySelector("img.activity-image")).toBe(image);
});

test("the debug panel's collapse button closes it and brings its row back", async (t) => {
  t.onTestFinished(cleanup);
  const scrolled: string[] = [];

  stubProperty(
    t,
    Element.prototype,
    "scrollIntoView",
    function (this: Element) {
      scrolled.push(this.className);
    },
  );

  const read = event(
    "tool.started",
    { name: "Read", id: "collapse-read" },
    "collapse-read",
  );

  const view = render(createElement(GroupedEventList, { events: [read] }));
  const group = getElement(view.container, ".activity-group");
  const toggle = view.getByRole("button", { name: "Debug activity: Read" });
  assert.equal(group.hasAttribute("data-debug-open"), false);
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  // Styles hide the heading time beside the debug caption's.
  assert.equal(group.hasAttribute("data-debug-open"), true);

  const collapse = view.getByRole("button", {
    name: "Collapse debug activity: Read",
  });

  assert.equal(
    collapse.getAttribute("aria-controls"),
    toggle.getAttribute("aria-controls"),
  );

  // The caret follows the panel's time.
  assert.equal(collapse.previousElementSibling?.tagName, "TIME");

  scrolled.length = 0;
  fireEvent.click(collapse);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(group.hasAttribute("data-debug-open"), false);
  expect(document.activeElement).toBe(toggle);
  await waitFor(() => assert.deepEqual(scrolled, ["activity-group-heading"]));
});

test("original response details release results on close and ignore replies for a previous task", async (t) => {
  t.onTestFinished(cleanup);

  const { ControllerContext } =
    await import("../../../app/state/controller-context");

  type Result = { available: boolean; original?: unknown };

  const pending: ((value: Result) => void)[] = [];

  const settle = (index: number, value: Result) => {
    const resolve = pending[index];
    assert.ok(resolve);
    resolve(value);
  };

  const controller = {
    transport: {
      tool: () => new Promise<Result>((resolve) => pending.push(resolve)),
    },
  } as unknown as import("../../../app/state/controller").Controller;

  const activity = event("agent.message", {
    text: "Hello",
    response_ref: "first",
  });

  const element = (taskId: string) =>
    createElement(
      ControllerContext.Provider,
      { value: controller },
      createElement(EventList, { events: [{ ...activity, task_id: taskId }] }),
    );

  const view = render(element("a"));

  const toggle = async (open: boolean) =>
    act(async () => {
      const details = view.container.querySelector(
        "details.activity-raw",
      ) as HTMLDetailsElement;

      details.open = open;
      details.dispatchEvent(new Event("toggle"));
    });

  await toggle(true);
  await waitFor(() => expect(pending).toHaveLength(1));
  expect(view.getByText("Loading original response…")).toBeTruthy();
  await toggle(false);

  await act(async () =>
    settle(0, { available: true, original: { secret: "stale-close" } }),
  );

  expect(
    view.container.querySelector('[aria-label="Original response"]'),
  ).toBeNull();

  await toggle(true);
  await waitFor(() => expect(pending).toHaveLength(2));
  view.rerender(element("b"));
  await waitFor(() => expect(pending).toHaveLength(3));

  await act(async () =>
    settle(1, { available: true, original: { secret: "stale-task" } }),
  );

  expect(view.container.textContent).not.toContain("stale-task");
  await act(async () => settle(2, { available: false }));
  expect(view.getByText("Original response unavailable.")).toBeTruthy();
  await toggle(false);

  expect(
    view.container.querySelector('[aria-label="Original response"]'),
  ).toBeNull();
});
