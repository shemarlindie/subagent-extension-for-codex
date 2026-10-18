// @vitest-environment jsdom
import assert from "node:assert/strict";

import { expect, test, type TestContext, vi } from "vitest";

import {
  claudeActivityPresentation,
  decodeClaudeActivityContent,
} from "../../../../service/features/providers/claude/events/activity";
import { decodedEvent } from "../../../../shared/events/decode";
import { task as buildTask } from "../../../app/state/controller-test-harness";
import type { Event as ActivityEvent } from "../../../app/state/types";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { formatUserDateTime } from "../../../shared/utils/user-date-time";
import { formatOutcomeTimestamp } from "../chat/timeline/outcome-timestamp";
import { ActivityContent, ActivityValue } from "./activity-content";
import { EVENT_TAIL_SIZE } from "./event-history";
import {
  EventDetails as EventList,
  EventList as GroupedEventList,
} from "./event-list";

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

/** A trigger's hover tooltip, closed again afterward. */
async function tooltipText(trigger: Element) {
  const user = userEvent.setup();
  await user.hover(trigger);
  const text = (await screen.findByRole("tooltip")).textContent;
  await user.unhover(trigger);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

  return text;
}

const eventIds = new Map<string, number>();
import userEvent from "@testing-library/user-event";

function normalizeContent(content: unknown) {
  if (content === undefined || typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content.flatMap((value) => {
      const decoded = decodeClaudeActivityContent(value);

      return decoded === undefined ? [] : [decoded];
    });
  }

  return decodeClaudeActivityContent(content);
}

function event(
  type: string,
  data: Record<string, unknown>,
  id = "one",
): ActivityEvent {
  if (!eventIds.has(id)) eventIds.set(id, eventIds.size + 1);

  const messageData =
    type === "agent.message" || type === "agent.content"
      ? {
          role: "assistant",
          ...data,
          ...(type === "agent.content" &&
          data.content === undefined &&
          typeof data.text === "string"
            ? { content: data.text }
            : {}),
        }
      : data;

  const content = messageData.content;

  const normalizedContent = normalizeContent(content);

  const normalizedData =
    content === undefined
      ? messageData
      : { ...messageData, content: normalizedContent };

  return decodedEvent({
    id: eventIds.get(id)!,
    task_id: "task",
    timestamp: "2026-10-02T12:00:00.000Z",
    type,
    data:
      type === "claude.activity" || data.raw_response
        ? {
            ...normalizedData,
            activity: claudeActivityPresentation({
              type,
              data: normalizedData,
            }),
          }
        : normalizedData,
  });
}

// assert.equal(element, null) diffs the whole jsdom object graph on failure,
// which never finishes and starves waitFor's timeout.
function assertAbsent(element: Element | null, message = "Unexpected element") {
  expect(element, message).toBeNull();
}

function markup(events: ActivityEvent[]) {
  const html = renderToStaticMarkup(createElement(EventList, { events }));

  return parseHtml(html);
}

type ScrollSize = { scrollHeight: number; clientHeight: number };

function groupCount(element: HTMLElement) {
  return element.querySelectorAll("[data-activity-id]").length;
}

// jsdom has no layout, so give scroll containers their content and visible heights.
function mockScrollSize(
  size: (element: HTMLElement) => ScrollSize | undefined,
) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return size(this)?.scrollHeight ?? 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return size(this)?.clientHeight ?? 0;
    },
  );
}

// Model real document flow: each activity occupies 100px after the status row,
// and the viewport shows 200px, so its end is at 40 + groups * 100 - 200.
// Reordering, adding or removing DOM nodes changes their measured position automatically.
function mockActivityGeometry() {
  mockScrollSize((element) =>
    element.matches(".activity-viewport")
      ? { scrollHeight: 40 + groupCount(element) * 100, clientHeight: 200 }
      : undefined,
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      let top = 100;
      let height = 300;

      if (this.matches("[data-activity-id]")) {
        const viewport = this.closest(".activity-viewport") as HTMLElement;

        const groups = Array.from(
          viewport.querySelectorAll("[data-activity-id]"),
        );

        top += 40 + groups.indexOf(this) * 100 - viewport.scrollTop;
        height = 100;
      }

      return {
        top,
        bottom: top + height,
        left: 0,
        right: 400,
        width: 400,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    },
  );
}

/** Replaces a property for one test and restores the original afterward. */
function stubProperty(
  t: TestContext,
  target: object,
  key: PropertyKey,
  value: unknown,
) {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });

  t.onTestFinished(() => {
    if (previous) Object.defineProperty(target, key, previous);
    else Reflect.deleteProperty(target, key);
  });
}

function activityMessages(prefix: string, count = 4) {
  return Array.from({ length: count }, (_, i) =>
    event(
      "agent.message",
      { text: `${prefix} message ${i}` },
      `${prefix}-${i}`,
    ),
  );
}

test("latest group is last and fresh progress moves an older tool to the end without resetting inspection", (t) => {
  t.onTestFinished(cleanup);

  const started = event(
    "tool.started",
    { id: "latest-order-read", name: "Read", input: { file_path: "a.ts" } },
    "latest-order-start",
  );

  const newer = event(
    "agent.message",
    { text: "Newer message" },
    "latest-order-message",
  );

  const view = render(
    createElement(GroupedEventList, { events: [started, newer] }),
  );

  const groups = () =>
    Array.from(view.container.querySelectorAll(".activity-group"));

  const [tool, starting] = groups();
  assert.ok(tool && starting);
  assert.match(starting.textContent ?? "", /Started a response\.\.\./);
  const debug = view.getByRole("button", { name: "Debug activity: Read" });
  fireEvent.click(debug);
  const raw = tool.querySelector("details.activity-raw") as HTMLDetailsElement;

  act(() => {
    raw.open = true;
    raw.dispatchEvent(new Event("toggle"));
  });

  const progress = event(
    "claude.activity",
    {
      type: "tool_progress",
      tool_use_id: "latest-order-read",
      tool_name: "Read",
      elapsed_time_seconds: 2,
    },
    "latest-order-progress",
  );

  view.rerender(
    createElement(GroupedEventList, { events: [started, newer, progress] }),
  );

  const [prepended, moved] = groups();
  expect(moved, "The updated group moves without remounting").toBe(tool);
  assert.ok(prepended);
  assert.match(prepended.textContent ?? "", /Started a response\.\.\./);

  expect(
    Array.from(tool.querySelectorAll("details.activity-raw")),
    "The original response inspector survives newly prepended debug events",
  ).toContain(raw);

  assert.equal(raw.open, true);
  assert.ok(raw.querySelector("pre"));
  assert.equal(debug.getAttribute("aria-expanded"), "true");
});

test("grouped event counts update without closing debug or remounting raw inspectors", async (t) => {
  t.onTestFinished(cleanup);

  const events = [1, 2, 3, 4].map((index) =>
    event(
      "workspace.indexed",
      { message: "Indexed the workspace", index },
      `count-indexed-${index}`,
    ),
  );

  const [, second] = events;
  assert.ok(second);

  const view = render(
    createElement(GroupedEventList, { events: events.slice(0, 2) }),
  );

  const debug = view.getByRole("button", {
    name: "Debug activity: Workspace indexed · 2 events",
  });

  fireEvent.click(debug);
  const panel = document.getElementById(debug.getAttribute("aria-controls")!)!;

  const [raw, older] = Array.from(
    panel.querySelectorAll<HTMLDetailsElement>("details.activity-raw"),
  );

  assert.ok(raw && older);
  assert.equal(raw.open, true, "Debug opens only its newest raw response");
  assert.equal(older.open, false);
  assertAbsent(older.querySelector("pre"));

  await waitFor(() =>
    assert.equal(
      raw.querySelector("pre")?.textContent,
      JSON.stringify(second.data, null, 2),
    ),
  );

  for (const count of [3, 4]) {
    view.rerender(
      createElement(GroupedEventList, { events: events.slice(0, count) }),
    );

    expect(
      view.getByRole("button", {
        name: `Debug activity: Workspace indexed · ${count} events`,
      }),
    ).toBe(debug);

    assert.equal(debug.getAttribute("aria-expanded"), "true");
    assert.equal(await tooltipText(debug), `Inspect ${count} raw responses`);
    assert.equal(panel.hidden, false);

    const inspectors = Array.from(
      panel.querySelectorAll("details.activity-raw"),
    );

    assert.equal(inspectors.length, count);
    expect(inspectors).toContain(raw);
    assert.equal(raw.open, true);

    assert.equal(
      raw.querySelector("pre")?.textContent,
      JSON.stringify(second.data, null, 2),
    );

    assert.equal(view.container.querySelectorAll(".activity-group").length, 1);
  }
});

// useReadingScroll's tests own scroll behavior. This checks Activity's wiring.
test("activity pins, anchors and returns to latest when the inspector scrolls instead", (t) => {
  t.onTestFinished(cleanup);
  const inspector = document.body.appendChild(document.createElement("div"));
  inspector.style.overflowY = "auto";
  t.onTestFinished(() => inspector.remove());

  // The inspector starts at 100px and shows 300px, with a 200px header above
  // the timeline, so its end is at 240 + groups * 100 - 300.
  mockScrollSize((element) =>
    element === inspector
      ? { scrollHeight: 240 + groupCount(inspector) * 100, clientHeight: 300 }
      : undefined,
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const timeline = 300 - inspector.scrollTop;
      let top = 100;
      let height = 300;
      if (this.matches(".activity-viewport")) top = timeline;

      if (this.matches("[data-activity-id]")) {
        const groups = Array.from(
          inspector.querySelectorAll("[data-activity-id]"),
        );

        top = timeline + 40 + groups.indexOf(this) * 100;
        height = 100;
      }

      return {
        top,
        bottom: top + height,
        left: 0,
        right: 400,
        width: 400,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    },
  );

  const fab = () =>
    view.queryByRole("button", { name: "Scroll to latest activity" });

  const initial = activityMessages("inspector-scroll");

  const view = render(createElement(GroupedEventList, { events: initial }), {
    container: inspector,
  });

  assert.equal(inspector.scrollTop, 340, "The inspector opens at the latest");
  inspector.scrollTop = 300;
  fireEvent.scroll(inspector);
  assertAbsent(fab(), "Scrolling within the buffer keeps the latest pinned");
  const pinned = activityMessages("inspector-scroll-pinned", 1);

  view.rerender(
    createElement(GroupedEventList, { events: [...initial, ...pinned] }),
  );

  assert.equal(inspector.scrollTop, 440, "Pinned updates follow the new end");
  inspector.scrollTop = 350;
  fireEvent.scroll(inspector);
  assert.ok(fab(), "Scrolling into history unpins");
  assert.ok(fab()!.classList.contains("activity-scroll-latest"));

  assert.equal(
    fab()!.dataset.direction,
    "down",
    "The chevron points to the end",
  );

  const [, anchor] = inspector.querySelectorAll<HTMLElement>(".activity-group");
  assert.ok(anchor);
  const before = anchor.getBoundingClientRect().top;

  view.rerender(
    createElement(GroupedEventList, {
      events: [
        ...initial.slice(1),
        ...pinned,
        ...activityMessages("inspector-scroll-next", 1),
      ],
    }),
  );

  assert.equal(anchor.getBoundingClientRect().top, before);
  assert.equal(inspector.scrollTop, 250);
  fireEvent.click(fab()!);

  assert.equal(
    inspector.scrollTop,
    440,
    "The inspector returns to the end of the timeline",
  );

  assertAbsent(fab());
});

test("timeline items mark their rail ends, status and trimmed history as data attributes", (t) => {
  t.onTestFinished(cleanup);

  const timeline = (events: ActivityEvent[]) =>
    render(createElement(GroupedEventList, { events }))
      .getByRole("region", { name: "Activity history" })
      .querySelector<HTMLElement>(".timeline")!;

  const whole = timeline(activityMessages("rail-whole", 3));
  assert.equal(whole.hasAttribute("data-trimmed"), false);
  const items = [...whole.querySelectorAll<HTMLElement>(".timeline-item")];

  assert.deepEqual(
    items.map((item) => [
      item.tagName,
      item.hasAttribute("data-first"),
      item.hasAttribute("data-last"),
    ]),
    [
      ["ARTICLE", true, false],
      ["ARTICLE", false, false],
      ["ARTICLE", false, true],
    ],
  );

  assert.ok(
    items.every(
      (item) =>
        item.matches(".activity-group[data-activity-id]") &&
        item.querySelector(".timeline-dot")?.getAttribute("data-status") ===
          item.dataset.status &&
        item.querySelector(".timeline-dot")?.getAttribute("aria-hidden") ===
          "true",
    ),
    "Collapsible props and the item status reach the rendered article and its dot",
  );

  cleanup();
  const trimmed = timeline(activityMessages("rail-trimmed", EVENT_TAIL_SIZE));
  assert.equal(trimmed.hasAttribute("data-trimmed"), true);

  assert.match(
    trimmed.previousElementSibling?.textContent ?? "",
    /Showing the most recent/,
    "The note precedes the rail where the oldest rows were dropped",
  );

  const trimmedItems = [
    ...trimmed.querySelectorAll<HTMLElement>(".timeline-item"),
  ];

  const [oldestRemaining] = trimmedItems;
  assert.ok(oldestRemaining);

  assert.equal(
    oldestRemaining.hasAttribute("data-first"),
    true,
    "The rail fades in above the oldest remaining item",
  );

  assert.equal(trimmedItems.at(-1)!.hasAttribute("data-last"), true);
});

test("new groups animate in and movement animations respect reduced motion", (t) => {
  t.onTestFinished(cleanup);
  mockActivityGeometry();

  let reducedMotion = false;
  let cancellations = 0;

  const calls: {
    element: HTMLElement;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
  }[] = [];

  stubProperty(
    t,
    HTMLElement.prototype,
    "animate",
    function (
      this: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      calls.push({ element: this, frames, options });

      return {
        cancel() {
          cancellations++;
        },
      };
    },
  );

  stubProperty(t, window, "matchMedia", () => ({ matches: reducedMotion }));

  const initial = activityMessages("animation", 4);
  const view = render(createElement(GroupedEventList, { events: [] }));
  const viewport = view.getByRole("region", { name: "Activity history" });

  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: 300,
  });

  view.rerender(createElement(GroupedEventList, { events: initial }));

  assert.equal(
    calls.length,
    0,
    "History loading into an empty feed appears in place",
  );

  // 440px of content in a 300px viewport puts the end at 140; stay within the buffer.
  assert.equal(viewport.scrollTop, 140);
  viewport.scrollTop = 110;
  fireEvent.scroll(viewport);
  const next = [...initial, ...activityMessages("animation-next", 1)];
  view.rerender(createElement(GroupedEventList, { events: next }));
  assert.equal(viewport.scrollTop, 240, "Pinned activity follows the new end");
  const newest = [...view.container.querySelectorAll(".activity-group")].at(-1);
  const entrance = calls.find((call) => call.element === newest);

  assert.ok(
    entrance,
    "A newly appended visible group receives an entrance animation",
  );

  const [entranceFrom, entranceTo] = entrance.frames;
  assert.ok(entranceFrom && entranceTo);
  assert.equal(entranceFrom.opacity, 0);
  assert.equal(entranceFrom.transform, "translateY(12px)");
  assert.equal(entranceTo.opacity, 1);
  assert.equal(entranceTo.transform, "translateY(0)");
  assert.ok(Number(entrance.options.duration) > 0);
  const retainedMovement = calls.find((call) => call.element !== newest);

  assert.ok(
    retainedMovement,
    "Existing visible groups animate to their new positions",
  );

  const [movementFrom] = retainedMovement.frames;
  assert.ok(movementFrom);
  assert.equal(movementFrom.transform, "translateY(130px)");
  assert.equal(movementFrom.opacity, 1);
  const cancelledBeforeScroll = cancellations;
  fireEvent.scroll(viewport);

  assert.equal(
    cancellations,
    cancelledBeforeScroll,
    "Following the end must not cancel new animations",
  );

  viewport.scrollTop = 80;
  fireEvent.scroll(viewport);

  assert.ok(
    cancellations > cancelledBeforeScroll,
    "Manual scrolling can interrupt movement animations",
  );

  reducedMotion = true;
  const callCount = calls.length;

  view.rerender(
    createElement(GroupedEventList, {
      events: [...next, ...activityMessages("animation-reduced", 1)],
    }),
  );

  assert.equal(
    calls.length,
    callCount,
    "Reduced motion suppresses entrance and movement animations",
  );
});

const families = [
  ["system", "init", "Claude connected"],
  ["system", "status", "Claude status"],
  ["system", "api_retry", "Retrying API request"],
  ["system", "compact_boundary", "Context compacted"],
  ["system", "local_command_output", "Command output"],
  ["system", "hook_started", "Hook started"],
  ["system", "hook_progress", "Hook progress"],
  ["system", "hook_response", "Hook finished"],
  ["system", "plugin_install", "Plugin installation"],
  ["system", "task_started", "Background task started"],
  ["system", "task_updated", "Background task updated"],
  ["system", "task_progress", "Background task progress"],
  ["system", "task_notification", "Background task finished"],
  ["system", "session_state_changed", "Session state changed"],
  ["system", "notification", "Notification"],
  ["system", "files_persisted", "Files saved"],
  ["system", "memory_recall", "Recalled from memory"],
  ["system", "elicitation_complete", "Input completed"],
  ["system", "permission_denied", "Permission denied"],
  ["system", "mirror_error", "Transcript sync failed"],
  ["tool_progress", undefined, "Tool running"],
  ["tool_use_summary", undefined, "Tool summary"],
  ["auth_status", undefined, "Authentication"],
  ["rate_limit_event", undefined, "Rate limit update"],
  ["prompt_suggestion", undefined, "Suggested next prompt"],
  ["future_event", undefined, "Future event"],
  ["system", "future_subtype", "Future subtype"],
] as const;

test("an activity family presents friendly fields and keeps raw-only data behind its inspector", () => {
  const raw = {
    type: "system",
    subtype: "init",
    extra_details: {
      item_count: 0,
      enabled: false,
      description: "Readable detail",
    },
    uuid: "raw-only-id",
  };

  const doc = markup([event("claude.activity", { ...raw, raw_response: raw })]);

  assert.match(doc.body.textContent ?? "", /Extra details/);
  assert.match(doc.body.textContent ?? "", /Item count0/);
  assert.match(doc.body.textContent ?? "", /EnabledNo/);
  assert.match(doc.body.textContent ?? "", /Readable detail/);
  const disclosure = doc.querySelector("details.activity-raw");

  assert.equal(
    disclosure?.querySelector("summary")?.textContent,
    "Raw response",
  );

  assert.equal(disclosure?.hasAttribute("open"), false);
  assertAbsent(disclosure?.querySelector("pre") ?? null);
  assert.ok(!doc.body.textContent?.includes("raw-only-id"));
});

test.each(families)(
  "activity UI titles %s %s as %s",
  (type, subtype, title) => {
    const raw = { type, ...(subtype ? { subtype } : {}) };

    const doc = markup([
      event("claude.activity", { ...raw, raw_response: raw }),
    ]);

    assert.equal(doc.querySelector("strong")?.textContent, title);
  },
);

test("mixed content, tool inputs and tool results are readable and HTML stays literal", () => {
  const malicious = "<script>window.injected = true</script>";

  const doc = markup([
    event("agent.message", { text: malicious }, "message"),
    event(
      "agent.content",
      {
        role: "assistant",
        content: {
          type: "thinking",
          thinking: "Reasoning detail",
          signature: "hidden-signature",
        },
      },
      "thinking",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "document",
          source: { type: "text", data: "Attached document text" },
        },
      },
      "document",
    ),
    event(
      "agent.content",
      { content: { type: "future_block", item_count: 0, enabled: false } },
      "future",
    ),
    event(
      "tool.started",
      {
        id: "tool",
        name: "Read",
        input: { file_path: "src/a.ts", offset: 0, enabled: false },
      },
      "started",
    ),
    event(
      "tool.completed",
      {
        id: "tool",
        error: false,
        content: [
          { type: "text", text: "Tool output" },
          { type: "text", text: malicious },
        ],
      },
      "completed",
    ),
  ]);

  const text = doc.body.textContent ?? "";

  for (const snippet of [
    malicious,
    "Thinking",
    "Reasoning detail",
    "Attached document text",
    "Future block",
    "File path",
    "src/a.ts",
    "Offset0",
    "EnabledNo",
    "Tool output",
    "Read started",
    "Read completed",
  ]) {
    assert.ok(text.includes(snippet), snippet);
  }

  assert.ok(!text.includes("hidden-signature"));
  assertAbsent(doc.querySelector("script"));
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 6);
});

test("streamed text, thinking and tool input fragments render as content", () => {
  const doc = markup([
    event(
      "claude.activity",
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Streamed text" },
        },
      },
      "text",
    ),
    event(
      "claude.activity",
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Streamed reasoning" },
        },
      },
      "thinking",
    ),
    event(
      "claude.activity",
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: '{"count":0' },
        },
      },
      "input",
    ),
  ]);

  assert.match(doc.body.textContent ?? "", /Streamed text/);
  assert.match(doc.body.textContent ?? "", /Streamed reasoning/);
  assert.match(doc.body.textContent ?? "", /Tool input fragment/);
  assert.match(doc.body.textContent ?? "", /\{"count":0/);
});

test("failures are distinguished for results, tool errors and denied permissions", () => {
  const doc = markup([
    event(
      "tool.completed",
      { id: "tool", error: true, content: "Read denied" },
      "tool",
    ),
    event(
      "agent.completed",
      {
        subtype: "error_max_turns",
        is_error: true,
        cost_usd: 0,
        errors: ["Turn limit"],
      },
      "result",
    ),
    event(
      "claude.activity",
      {
        type: "system",
        subtype: "permission_denied",
        message: "Permission blocked",
      },
      "permission",
    ),
  ]);

  assert.equal(doc.querySelectorAll(".activity-error").length, 3);

  for (const snippet of [
    "Tool failed",
    "Agent failed",
    "Permission denied",
    "Turn limit",
    "Cost$0.00",
  ]) {
    assert.ok(doc.body.textContent?.includes(snippet), snippet);
  }
});

test("opening raw response shows the original full JSON and preserves disclosure through refresh", async (t) => {
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
  assertAbsent(details.querySelector("pre"));

  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });

  await waitFor(() =>
    assert.equal(
      details.querySelector("pre")?.textContent,
      JSON.stringify(raw, null, 2),
    ),
  );

  view.rerender(createElement(EventList, { events: [{ ...activity }] }));
  expect(view.container.querySelector("details.activity-raw")).toBe(details);
  assert.equal(details.open, true);

  assert.equal(
    details.querySelector("pre")?.textContent,
    JSON.stringify(raw, null, 2),
  );

  assertAbsent(view.container.querySelector("script"));

  await act(async () => {
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });

  await waitFor(() => assertAbsent(details.querySelector("pre")));
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

  await waitFor(() =>
    assert.equal(
      details.querySelector("pre")?.textContent,
      JSON.stringify(data, null, 2),
    ),
  );
});

test("activity metadata formats currency, seconds, token counts and utilization", () => {
  const values = {
    cost_usd: 0.1234,
    total_cost_usd: 0.1234,
    duration_ms: 2500,
    duration_api_ms: 0,
    retry_delay_ms: 500,
    elapsed_time_seconds: 1.25,
    usage: { input_tokens: 12345, output_tokens: 0 },
    rate_limit_info: { utilization: 0.75 },
  };

  const doc = markup([event("agent.completed", values)]);

  const fields = new Map(
    Array.from(doc.querySelectorAll(".activity-fields > div")).map((field) => [
      field.querySelector("dt")?.textContent,
      field.querySelector("dd")?.textContent,
    ]),
  );

  const cost = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(values.cost_usd);

  assert.equal(fields.get("Cost"), cost);
  assert.equal(fields.has("Total cost"), false, "Avoid duplicated result cost");
  assert.equal(fields.get("Duration"), "2.5 s");
  assert.equal(fields.get("API duration"), "0 s");
  assert.equal(fields.get("Retry delay"), "0.5 s");
  assert.equal(fields.get("Elapsed time"), "1.25 s");
  assert.equal(fields.get("Input tokens"), (12345).toLocaleString());
  assert.equal(fields.get("Output tokens"), "0");
  assert.equal(fields.get("Utilization"), "75%");
});

test("supported base64 images render inline, including images nested in documents and tool results", () => {
  const image = (media_type: string) => ({
    type: "image",
    source: { type: "base64", media_type, data: "aGVsbG8=" },
  });

  const doc = markup([
    event(
      "agent.content",
      {
        content: [
          image("image/png"),
          image("image/jpeg"),
          image("image/gif"),
          image("image/webp"),
        ],
      },
      "images",
    ),
    event(
      "tool.completed",
      {
        id: "tool",
        content: [{ type: "tool_result", content: [image("image/png")] }],
      },
      "nested-tool",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "document",
          title: "Nested document",
          source: {
            type: "content",
            content: [
              image("image/png"),
              { type: "text", text: "Nested caption" },
            ],
          },
        },
      },
      "nested-document",
    ),
  ]);

  const images = Array.from(doc.querySelectorAll("img.activity-image"));
  assert.equal(images.length, 6);

  for (const image of images) {
    assert.match(
      image.getAttribute("src") ?? "",
      /^data:image\/(png|jpeg|gif|webp);base64,aGVsbG8=$/,
    );

    assert.equal(image.getAttribute("alt"), "Claude activity attachment");
  }

  assert.match(doc.body.textContent ?? "", /Nested document/);
  assert.match(doc.body.textContent ?? "", /Nested caption/);
});

test("unsupported image sources present readable metadata without embedding unsafe media", () => {
  const doc = markup([
    event(
      "agent.content",
      {
        content: {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/svg+xml",
            data: "private-encoded-svg",
          },
        },
      },
      "svg",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "image",
          source: { type: "url", url: "https://example.invalid/image.png" },
        },
      },
      "remote",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "private-encoded-pdf",
          },
        },
      },
      "pdf",
    ),
  ]);

  assert.equal(doc.querySelectorAll("img").length, 0);
  const text = doc.body.textContent ?? "";

  for (const snippet of [
    "Image",
    "Document",
    "Source",
    "Media type",
    "image/svg+xml",
    "application/pdf",
    "https://example.invalid/image.png",
  ]) {
    assert.ok(text.includes(snippet), snippet);
  }

  assert.ok(!text.includes("private-encoded-svg"));
  assert.ok(!text.includes("private-encoded-pdf"));
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 3);
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
    assert.equal(
      raw.querySelector("pre")?.textContent,
      JSON.stringify(rawStart, null, 2),
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

  assert.equal(
    raw.querySelector("pre")?.textContent,
    JSON.stringify(rawStart, null, 2),
  );

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
      live.container.querySelector("button.activity-debug-toggle")!,
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

  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await tooltipText(toggle), "Inspect 1 raw response");
  assert.ok(toggle.classList.contains("activity-debug-toggle"));
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  assert.ok(panel.classList.contains("activity-debug-panel"));
  assert.equal(panel.hidden, true);
  assertAbsent(view.queryByText("Raw response", { selector: "summary" }));
  const message = view.container.querySelector(".activity-message")!;

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

  toggle.focus();

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

  assert.equal(
    raw.querySelector("pre")?.textContent,
    JSON.stringify(activity.data.raw_response, null, 2),
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

  assert.equal(
    raw.querySelector("pre")?.textContent,
    JSON.stringify(activity.data.raw_response, null, 2),
  );

  await act(async () => {
    raw.open = false;
    raw.dispatchEvent(new Event("toggle"));
  });

  view.rerender(createElement(GroupedEventList, { events: [{ ...activity }] }));
  expect(panel.querySelector("details.activity-raw")).toBe(raw);
  assert.equal(raw.open, false, "A manual collapse survives a refresh");
  assertAbsent(raw.querySelector("pre"));
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
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;

  fireEvent.click(toggle);

  // Child transitions and other properties bubble up but do not reveal the panel.
  fireEvent.transitionEnd(panel.querySelector(".activity-debug-caption")!, {
    propertyName: "height",
  });

  fireEvent.transitionEnd(panel, { propertyName: "opacity" });
  // A reveal would scroll on a later frame, so give one time to land.
  await new Promise((resolve) => setTimeout(resolve, 50));
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

// activity-timeline's tests cover which terminal operations stay neutral.
test("neutral terminal operations never display Done badges", () => {
  const events = [
    event(
      "claude.activity",
      { type: "system", subtype: "hook_started", hook_id: "cancel-hook" },
      "cancel-hook-start",
    ),
    event(
      "claude.activity",
      {
        type: "system",
        subtype: "hook_response",
        hook_id: "cancel-hook",
        outcome: "cancelled",
      },
      "cancel-hook-finish",
    ),
  ];

  const doc = parseHtml(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  );

  assert.equal(doc.querySelectorAll(".activity-group").length, 1);
  assert.equal(doc.querySelectorAll(".activity-badge").length, 0);
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
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  assert.equal(panel.hidden, true);
  assertAbsent(view.container.querySelector("img.activity-image"));

  assert.equal(
    view.container.querySelectorAll("details.activity-raw").length,
    0,
  );

  fireEvent.click(toggle);
  assert.equal(panel.hidden, false);
  const image = panel.querySelector("img.activity-image")!;
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

const nestedContentNotice = "Nested content omitted · inspect raw response";

function wrapNested(
  value: unknown,
  wrap: (value: unknown) => unknown,
  levels: number,
): unknown {
  for (let i = 0; i < levels; i++) value = wrap(value);

  return value;
}

function contentMarkup(content: unknown) {
  return parseHtml(
    renderToStaticMarkup(createElement(ActivityContent, { content })),
  );
}

for (const [name, wrap] of [
  ["arrays", (value: unknown) => [value]],
  [
    "tool results",
    (value: unknown) => ({ type: "tool_result", content: value }),
  ],
  [
    "MCP tool results",
    (value: unknown) => ({ type: "mcp_tool_result", content: value }),
  ],
  [
    "documents",
    (value: unknown) => ({
      type: "document",
      source: { type: "content", content: value },
    }),
  ],
] as const) {
  test(`deeply nested ${name} render a bounded fallback`, () => {
    const content = wrapNested(
      { type: "text", text: "Hidden deep text" },
      wrap,
      10000,
    );

    const doc = contentMarkup(content);
    assert.equal(doc.querySelector(".muted")?.textContent, nestedContentNotice);
    assert.ok(!doc.body.textContent?.includes("Hidden deep text"));
    assertAbsent(doc.querySelector("pre"));
  });
}

test("content remains readable through the nesting limit and is omitted beyond it", () => {
  const text = { type: "text", text: "Visible at boundary" };
  const withinLimit = contentMarkup(wrapNested(text, (value) => [value], 6));
  assert.equal(withinLimit.body.textContent, "Visible at boundary");
  const beyondLimit = contentMarkup(wrapNested(text, (value) => [value], 7));
  assert.equal(beyondLimit.body.textContent, nestedContentNotice);
});

test("metadata and content share a nesting budget without serializing omitted payloads", () => {
  const payload = {
    secret: "Hidden metadata",
    toJSON() {
      throw new Error("Omitted payload must not be serialized");
    },
  };

  const tool = { type: "tool_use", name: "Read", input: payload };
  const doc = contentMarkup(wrapNested(tool, (value) => [value], 6));
  assert.ok(doc.body.textContent?.includes(nestedContentNotice));
  assert.ok(!doc.body.textContent?.includes("Hidden metadata"));
  const metadata = wrapNested(payload, (value) => ({ nested: value }), 10000);

  const html = renderToStaticMarkup(
    createElement(ActivityValue, { value: metadata }),
  );

  assert.ok(html.includes(nestedContentNotice));
  assert.ok(!html.includes("Hidden metadata"));
  assert.ok(!html.includes("<pre>"));
});

test("cyclic content and metadata stop at the nesting limit", () => {
  const tool: Record<string, unknown> = { type: "tool_result" };
  tool.content = tool;

  assert.ok(
    contentMarkup(tool).body.textContent?.includes(nestedContentNotice),
  );

  const metadata: Record<string, unknown> = {};
  metadata.self = metadata;

  const html = renderToStaticMarkup(
    createElement(ActivityValue, { value: metadata }),
  );

  assert.ok(html.includes(nestedContentNotice));
});

test("empty content objects and undefined-only fields do not add field-list spacing", () => {
  for (const content of [{}, { unused: undefined }, { type: "future_block" }]) {
    const doc = contentMarkup(content);
    assertAbsent(doc.querySelector("dl"));
  }
});

test("error fields and assistant errors preserve exact diagnostic text", () => {
  const diagnostic = "failed_to_read /tmp/my_file.test.ts: ENOENT.code";
  const content = contentMarkup({ error: diagnostic });
  assert.equal(content.querySelector("dd")?.textContent, diagnostic);

  const doc = markup([
    event(
      "claude.activity",
      {
        type: "assistant",
        error: diagnostic,
        message: { content: [] },
      },
      "diagnostic-assistant",
    ),
  ]);

  assert.equal(doc.querySelector("p.error")?.textContent, diagnostic);
});

test("stream blocks ignore invalid indexes while default and numeric indexes accumulate independently", () => {
  const frames: Record<string, unknown>[] = [
    { type: "message_start", message: { id: "validated-stream-indexes" } },
    {
      type: "content_block_start",
      content_block: { type: "text", text: "Default " },
    },
    {
      type: "content_block_delta",
      index: null,
      delta: { type: "text_delta", text: "block" },
    },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "Second " },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "block" },
    },
  ];

  for (const index of [
    {},
    "0",
    -1,
    0.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    frames.push(
      {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "Invalid start" },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: "Invalid delta" },
      },
    );
  }

  frames.push({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: " remains" },
  });

  const events = frames.map((frame, i) =>
    event(
      "claude.activity",
      {
        type: "stream_event",
        event: frame,
      },
      `validated-stream-index-${i}`,
    ),
  );

  const doc = parseHtml(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  );

  const blocks = Array.from(
    doc.querySelectorAll(".activity-stream > .activity-body .markdown-body p"),
    (node) => node.textContent,
  );

  assert.deepEqual(blocks, ["Default block remains", "Second block"]);
});

test("fenced code in message text renders as a code block", () => {
  const doc = contentMarkup([
    { type: "text", text: "Run this:\n```sh\nnpm test\n```\nThen retry." },
  ]);

  assert.equal(doc.querySelector("pre.activity-code")?.textContent, "npm test");

  assert.deepEqual(
    [...doc.querySelectorAll("p.activity-text")].map((p) => p.textContent),
    ["Run this:", "Then retry."],
  );
});

test("unclosed fences while streaming stay plain text", () => {
  const doc = contentMarkup("Partial ```sh\nnpm te");
  assertAbsent(doc.querySelector("pre"));
  assert.equal(doc.querySelector("p")?.textContent, "Partial ```sh\nnpm te");
});

test("thinking-only assistant messages are not styled as message cards", () => {
  const thinking = event(
    "agent.content",
    { role: "assistant", content: { type: "thinking", thinking: "Hmm" } },
    "thinking-only",
  );

  const reply = event(
    "agent.content",
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Hmm" },
        { type: "text", text: "Done" },
      ],
    },
    "thinking-plus-reply",
  );

  const view = render(
    createElement(GroupedEventList, { events: [thinking, reply] }),
  );

  const groups = view.container.querySelectorAll(".activity-group");
  assert.equal(groups.length, 2);

  const quiet = [...groups].filter((g) =>
    g.classList.contains("activity-thinking-only"),
  );

  const [thinkingGroup] = quiet;
  assert.equal(quiet.length, 1);
  assert.ok(thinkingGroup);
  // A thinking-only message must not be titled as an assistant reply.
  assert.equal(thinkingGroup.querySelector("strong")?.textContent, "Thinking");
  // The thinking text is only available through the debug view.
  assertAbsent(thinkingGroup.querySelector("details"));
  assert.equal(view.getAllByText("Assistant").length, 1);
  // The debug toggle names the row the way its heading does.
  assert.ok(view.getByRole("button", { name: "Debug activity: Thinking" }));
  cleanup();
});

test("an assistant response bubble contains only its thinking note", () => {
  const raw = {
    type: "assistant",
    message: {
      id: "thinking-bubble",
      content: [
        { type: "text", text: "Response text" },
        { type: "thinking", thinking: "Reasoning note" },
        { type: "text", text: "More response text" },
      ],
    },
  };

  const events = [
    event(
      "agent.message",
      {
        role: "assistant",
        text: "Response text",
        content: { type: "text", text: "Response text" },
        raw_response: raw,
      },
      "thinking-bubble-message",
    ),
    event(
      "agent.content",
      {
        role: "assistant",
        content: { type: "thinking", thinking: "Reasoning note" },
        raw_response: raw,
      },
      "thinking-bubble-thinking",
    ),
    event(
      "agent.content",
      {
        role: "assistant",
        content: { type: "text", text: "More response text" },
        raw_response: raw,
      },
      "thinking-bubble-extra-text",
    ),
  ];

  const view = render(createElement(GroupedEventList, { events }));
  const group = view.container.querySelector(".activity-message")!;
  const bubble = group.querySelector(".activity-body")!;

  assert.equal(
    group.querySelector(".activity-group-secondary")?.textContent,
    "Started a response...",
  );

  assert.equal(
    bubble.querySelector("details.activity-thinking summary")?.textContent,
    "Thinking",
  );

  assert.deepEqual(
    [...bubble.querySelectorAll(".activity-text")].map(
      (node) => node.textContent,
    ),
    ["Reasoning note"],
  );

  assert.ok(!bubble.textContent?.includes("Response text"));
  assert.ok(!bubble.textContent?.includes("More response text"));

  cleanup();
});

test("the trimmed note summarizes dropped events only for the task being shown", (t) => {
  t.onTestFinished(cleanup);
  const events = activityMessages("dropped-note", EVENT_TAIL_SIZE);

  const dropped = {
    task_id: "task",
    count: 12,
    from: "2026-10-02T12:00:00.000Z",
    to: "2026-10-02T12:01:30.000Z",
    toolCalls: 5,
    tools: { Bash: 3, Read: 2 },
    messages: 4,
    failures: 1,
    retries: 0,
  };

  const note = (summary = dropped) =>
    render(
      createElement(GroupedEventList, { events, dropped: summary }),
    ).container.querySelector(".activity-trimmed-note")!.textContent;

  assert.match(
    note(),
    /12 earlier events over 1m 30s not shown\. 5 tool calls \(Bash 3, Read 2\) · 4 messages · 1 failure\./,
  );

  cleanup();

  assert.doesNotMatch(note({ ...dropped, task_id: "other" }), /earlier events/);
});

test("activity times use Chat's format and tooltip", (t) => {
  t.onTestFinished(cleanup);
  const preferences = { locale: "en-US", timeZone: "UTC" };

  const read = event(
    "tool.started",
    { name: "Read", id: "read-time" },
    "read-time",
  );

  const date = formatUserDateTime(read.timestamp, preferences, {
    timeZoneName: undefined,
  });

  // Expanded: the time shares the debug caption's line, in Chat's format.
  const expanded = render(
    createElement(GroupedEventList, { events: [read], preferences }),
  ).container;

  fireEvent.click(expanded.querySelector(".activity-debug-toggle")!);

  const time = expanded.querySelector(".activity-debug-head time")!;

  assert.equal(
    time.textContent,
    formatOutcomeTimestamp(read.timestamp, preferences),
  );

  assert.equal(time.getAttribute("aria-label"), date);

  assert.ok(
    expanded
      .querySelector(".activity-debug-caption")!
      .compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

  cleanup();

  // Top level: the clock stays as it was, and its tooltip is the date alone.
  const heading = render(
    createElement(GroupedEventList, { events: [read], preferences }),
  ).container.querySelector(".activity-group-heading time")!;

  assert.equal(
    heading.getAttribute("aria-label"),
    formatUserDateTime(read.timestamp, preferences, {
      timeZoneName: undefined,
    }),
  );

  assert.equal(
    heading.textContent,
    new Date(read.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }),
  );
});

test("a thinking row shows how long the worker thought", (t) => {
  t.onTestFinished(cleanup);

  const at = (second: number, e: ActivityEvent): ActivityEvent => ({
    ...e,
    timestamp: new Date(Date.UTC(2026, 9, 2, 12, 0, second)).toISOString(),
  });

  const view = render(
    createElement(GroupedEventList, {
      events: [
        at(0, event("thinking_tokens", {}, "think-a")),
        at(3, event("thinking_tokens", {}, "think-b")),
        at(7, event("agent.message", { text: "Done" }, "think-reply")),
      ],
    }),
  );

  const titles = [...view.container.querySelectorAll("strong")].map(
    (title) => title.textContent,
  );

  // The finished row names its duration instead of also saying "Thinking…".
  assert.ok(titles.includes("Thought for 7s"), titles.join(" | "));
  assert.ok(!titles.includes("Thinking…"));
  assertAbsent(view.container.querySelector(".activity-duration"));
});

test("a thinking row with nothing after it counts up only while the worker runs", (t) => {
  t.onTestFinished(() => {
    cleanup();
    vi.useRealTimers();
  });

  vi.useFakeTimers({ now: Date.parse("2026-10-02T12:00:05.000Z") });

  const events = [
    {
      ...event("thinking_tokens", {}, "live-think"),
      timestamp: "2026-10-02T12:00:00.000Z",
    },
  ];

  const view = render(
    createElement(GroupedEventList, { events, running: true }),
  );

  const duration = () =>
    view.container.querySelector(".activity-duration")?.textContent;

  assert.equal(duration(), "5s");
  act(() => void vi.advanceTimersByTime(3000));
  assert.equal(duration(), "8s");
  view.rerender(createElement(GroupedEventList, { events, running: false }));
  assertAbsent(view.container.querySelector(".activity-duration"));
});

test("task completion activity includes the accumulated runtime", (t) => {
  t.onTestFinished(cleanup);
  const events = [event("task.completed", {}, "completed-runtime")];

  const view = render(
    createElement(GroupedEventList, { events, runtimeMs: 95_000 }),
  );

  assert.equal(
    view.container.querySelector(".activity-group-title strong")?.textContent,
    "Task completed after 1m 35s",
  );

  view.rerender(createElement(GroupedEventList, { events }));

  assert.equal(
    view.container.querySelector(".activity-group-title strong")?.textContent,
    "Task completed",
  );
});

test("a reply shows its plain preview outside Debug with More and Less controls", (t) => {
  t.onTestFinished(cleanup);
  const text = `**Done.**\n\n- one\n\n${"More detail. ".repeat(12)}`;

  const doc = parseHtml(
    renderToStaticMarkup(
      createElement(GroupedEventList, {
        events: [
          event(
            "claude.activity",
            {
              type: "result",
              subtype: "success",
              is_error: false,
              result: text,
            },
            "markdown-result",
          ),
          event("agent.reply", { text, turn: 1 }, "markdown-reply"),
          event("task.note", { summary: "**plain status**" }, "plain-note"),
        ],
      }),
    ),
  );

  const summaries = [...doc.querySelectorAll(".activity-group-summary")];

  const rendered = summaries.filter((summary) =>
    summary.querySelector("strong"),
  );

  expect(rendered).toHaveLength(1);
  expect(rendered.every((summary) => summary.querySelector("li"))).toBe(true);

  expect(summaries.some((s) => s.textContent === "**plain status**")).toBe(
    true,
  );

  const reply = render(
    createElement(GroupedEventList, {
      events: [event("agent.reply", { text, turn: 1 }, "reply-preview")],
    }),
  );

  const group = reply.container.querySelector(".activity-group")!;

  expect(group.querySelector(".activity-group-title")?.textContent).toBe(
    "Reply",
  );

  expect(group.querySelector(".activity-group-secondary")).toBeNull();
  expect(group.querySelector(".activity-debug-body")).toBeNull();

  const responseBody = group.querySelector(".activity-body .activity-text")!;
  expect(responseBody.textContent).toBe(`${text.slice(0, 100).trimEnd()}...`);

  const more = group.querySelector<HTMLButtonElement>(
    ".activity-reply-toggle",
  )!;

  expect(more.textContent).toBe("More");
  fireEvent.click(more);
  expect(responseBody.textContent).toBe(text);
  expect(more.textContent).toBe("Less");
  fireEvent.click(more);
  expect(responseBody.textContent).toBe(`${text.slice(0, 100).trimEnd()}...`);
  expect(more.textContent).toBe("More");

  fireEvent.click(group.querySelector(".activity-debug-toggle")!);
  const debug = group.querySelector(".activity-debug-body")!;
  expect(debug.querySelector(".activity-reply-toggle")).toBeNull();
  expect(debug.querySelector(".activity-text")).toBeNull();

  expect(debug.querySelector(".activity-raw pre")?.textContent).toContain(
    JSON.stringify(text),
  );
});

test("Activity includes the task's initial request at the start, including before events exist", (t) => {
  t.onTestFinished(cleanup);

  const task = {
    ...buildTask("task"),
    id: "task",
    description: "**First request**",
    created_by: "user" as const,
    created_at: "2026-10-02T12:00:00.000Z",
  };

  const view = render(createElement(GroupedEventList, { task, events: [] }));

  expect(
    view.container.querySelector(".activity-request .chat-bubble")?.textContent,
  ).toBe(task.description);

  expect(
    view.container.querySelector(".activity-request .chat-bubble strong"),
  ).toBeNull();

  expect(
    view.container.querySelector(".activity-request .activity-debug-toggle"),
  ).toBeNull();

  view.rerender(
    createElement(GroupedEventList, {
      task,
      events: [event("task.started", { turn: 1 }, "initial-start")],
    }),
  );

  expect(
    view.container
      .querySelector(".timeline")
      ?.firstElementChild?.classList.contains("activity-request"),
  ).toBe(true);

  view.rerender(createElement(GroupedEventList, { task, events: [], turn: 2 }));
  expect(view.container.querySelector(".activity-request")).toBeNull();
  view.rerender(createElement(GroupedEventList, { task, events: [], turn: 1 }));

  expect(
    view.container.querySelector(".activity-request .chat-bubble")?.textContent,
  ).toBe(task.description);

  const events = Array.from({ length: EVENT_TAIL_SIZE }, (_, index) => ({
    ...event("task.started", { turn: 1 }, `initial-capacity-${index}`),
    id: index + 1,
  }));

  view.rerender(createElement(GroupedEventList, { task, events }));
  expect(view.container.querySelector(".activity-request")).not.toBeNull();

  view.rerender(
    createElement(GroupedEventList, {
      task,
      events,
      dropped: {
        task_id: task.id,
        count: 1,
        from: task.created_at,
        to: task.created_at,
        tools: {},
        toolCalls: 0,
        messages: 0,
        failures: 0,
        retries: 0,
      },
    }),
  );

  expect(view.container.querySelector(".activity-request")).toBeNull();
});

test("assistant groups keep attachments visible while text stays in raw JSON", (t) => {
  t.onTestFinished(cleanup);
  const raw_response = { message: { id: "attachment-response" } };

  const view = render(
    createElement(GroupedEventList, {
      events: [
        event(
          "agent.message",
          { role: "assistant", text: "Hidden response text", raw_response },
          "attachment-text",
        ),
        event(
          "agent.content",
          {
            role: "assistant",
            content: {
              type: "document",
              title: "Attached notes",
              source: { type: "text", data: "Visible attachment" },
            },
            raw_response,
          },
          "attachment-document",
        ),
      ],
    }),
  );

  expect(view.container.querySelectorAll(".activity-group")).toHaveLength(1);
  expect(view.container.textContent).toContain("Attached notes");
  expect(view.container.textContent).toContain("Visible attachment");
  expect(view.container.textContent).not.toContain("Hidden response text");
});

test("Activity user messages use Chat bubbles with literal text outside Debug", (t) => {
  t.onTestFinished(cleanup);
  const text = "**Keep this literal**\n```text\nuser input\n```";

  const view = render(
    createElement(GroupedEventList, {
      events: [
        event("agent.content", { role: "user", text }, "bubble-sdk-user"),
        event(
          "task.instruction",
          {
            message_id: "follow-up",
            from: "user",
            message: "Follow up",
            delivery: "queue",
          },
          "bubble-instruction",
        ),
        event(
          "task.instruction",
          {
            message_id: "parent-brief",
            from: "parent",
            message: "Parent brief",
            delivery: "queue",
          },
          "bubble-parent",
        ),
      ],
    }),
  );

  expect(
    [
      ...view.container.querySelectorAll(
        '.chat-message[data-from="user"] .chat-bubble',
      ),
    ].map((bubble) => bubble.textContent),
  ).toEqual([text, "Follow up"]);

  expect(view.container.querySelector(".chat-bubble strong")).toBeNull();
  expect(view.container.querySelector(".chat-bubble pre")).toBeNull();
  expect(view.container.querySelector(".activity-debug-body")).toBeNull();
  const first = view.container.querySelector(".activity-group")!;
  expect(first.querySelector(":scope > .activity-body")).toBeNull();
  fireEvent.click(first.querySelector(".activity-debug-toggle")!);
  expect(first.querySelector(".activity-debug-body .chat-bubble")).toBeNull();

  expect(first.querySelector(".activity-raw pre")?.textContent).toContain(
    JSON.stringify(text),
  );
});

const markdownText = "**bold**\n\n- one\n- two";

const messageBody = (type: "assistant" | "user") =>
  markup([
    event(
      "claude.activity",
      {
        type,
        message: {
          role: type,
          content: [{ type: "text", text: markdownText }],
        },
      },
      `body-${type}`,
    ),
  ]);

const workerContent = (content: unknown) =>
  parseHtml(
    renderToStaticMarkup(
      createElement(ActivityContent, { content, markdown: true }),
    ),
  );

test.each([
  {
    name: "the worker's text",
    render: () => workerContent([{ type: "text", text: markdownText }]),
    markdown: true,
  },
  {
    name: "tool output",
    render: () =>
      workerContent([{ type: "tool_result", content: markdownText }]),
    markdown: false,
  },
  {
    name: "content without the Markdown option",
    render: () => contentMarkup({ type: "text", text: markdownText }),
    markdown: false,
  },
  {
    name: "an assistant message body",
    render: () => messageBody("assistant"),
    markdown: true,
  },
  {
    name: "a user message body",
    render: () => messageBody("user"),
    markdown: false,
  },
])("$name renders Markdown: $markdown", ({ render, markdown }) => {
  const doc = render();

  if (markdown) {
    expect(doc.querySelector(".activity-markdown strong")?.textContent).toBe(
      "bold",
    );

    expect(doc.querySelectorAll(".activity-markdown li")).toHaveLength(2);
  } else {
    expect(doc.querySelector(".activity-markdown")).toBeNull();
    expect(doc.querySelector(".activity-text")?.textContent).toBe(markdownText);
  }
});

test("rate-limit details show the latest update without opening Debug", (t) => {
  t.onTestFinished(cleanup);
  const preferences = { locale: "en-US", timeZone: "America/Los_Angeles" };
  const resetsAt = 1791030000;

  const update = (status: string, utilization: number, id: string) =>
    event(
      "claude.activity",
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status,
          utilization,
          rateLimitType: "five_hour",
          resetsAt,
          overageStatus: "rejected",
          overageResetsAt: resetsAt,
          overageDisabledReason: "out_of_credits",
        },
      },
      id,
    );

  const view = render(
    createElement(GroupedEventList, {
      events: [
        update("allowed", 0.12, "rate-allowed"),
        update("rejected", 1, "rate-rejected"),
      ],
      preferences,
    }),
  );

  const stats = view.container.querySelector(".activity-group-stats");

  expect(stats?.textContent).toBe(
    `5-hour window · 100% used · Resets ${formatUserDateTime(new Date(resetsAt * 1000).toISOString(), preferences, { timeZoneName: undefined, second: undefined })}`,
  );

  expect(stats?.textContent).not.toMatch(/PDT|PST|GMT|UTC/);

  expect(view.container.querySelectorAll(".activity-group")).toHaveLength(1);
  expect(view.container.querySelector(".activity-debug-body")).toBeNull();
  fireEvent.click(view.container.querySelector(".activity-debug-toggle")!);

  expect(
    view.container.querySelector(".activity-debug-body")?.textContent,
  ).toContain("StatusAllowed");

  expect(
    view.container.querySelector(".activity-debug-body")?.textContent,
  ).toContain("rejected");
});

test("rate-limit rows retain each window when an overage update arrives", (t) => {
  t.onTestFinished(cleanup);

  const update = (rateLimitType: string, utilization: number, id: string) =>
    event(
      "claude.activity",
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", rateLimitType, utilization },
      },
      id,
    );

  const view = render(
    createElement(GroupedEventList, {
      events: [
        update("five_hour", 0.1, "windows-five-old"),
        update("seven_day", 0.4, "windows-week"),
        update("five_hour", 0.2, "windows-five-new"),
        update("overage", 0.9, "windows-overage"),
      ],
    }),
  );

  expect(
    [...view.container.querySelectorAll(".activity-group-stats")].map(
      (row) => row.textContent,
    ),
  ).toEqual(["5-hour window · 20% used", "7-day window · 40% used"]);

  expect(view.container.querySelectorAll(".activity-group")).toHaveLength(1);
});

test("rate-limit rows omit windows without valid utilization", (t) => {
  t.onTestFinished(cleanup);

  const view = render(
    createElement(GroupedEventList, {
      events: [
        event(
          "claude.activity",
          {
            type: "rate_limit_event",
            rate_limit_info: {
              status: "allowed_warning",
              utilization: NaN,
              resetsAt: 1e100,
            },
          },
          "rate-warning",
        ),
      ],
    }),
  );

  expect(view.container.querySelector(".activity-group-stats")).toBeNull();
});

test("a turn completion shows stats and keeps its result in raw JSON", (t) => {
  t.onTestFinished(cleanup);
  const result = "Done. ".repeat(30);

  const view = render(
    createElement(GroupedEventList, {
      events: [
        event("agent.completed", {
          type: "result",
          subtype: "success",
          result,
          duration_ms: 65_000,
          cost_usd: 0.5,
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 15_874,
            cache_read_input_tokens: 0,
            output_tokens: 426,
          },
        }),
        event("agent.reply", { text: result, turn: 1 }),
      ],
    }),
  ).container;

  const cost = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(0.5);

  const compact = (value: number) =>
    new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);

  const completion = [...view.querySelectorAll(".activity-group")].find(
    (group) => group.textContent?.includes("Turn completed"),
  )!;

  assert.equal(
    completion.querySelector(".activity-group-stats")?.textContent,
    `1m 05s · ${compact(15_876)} in · ${compact(426)} out tokens · ${cost} session cost`,
  );

  fireEvent.click(completion.querySelector(".activity-debug-toggle")!);

  // The result remains available in JSON, not as a second readable response.
  const debug = completion.querySelector(".activity-debug-body")!;
  const raw = debug.querySelector(".activity-raw pre")!;
  assert.ok(raw.textContent?.includes(result));
  debug.querySelector(".activity-raw")?.remove();
  assert.ok(!debug.textContent?.includes(result));
  expect(debug.querySelector(".activity-reply-toggle")).toBeNull();
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
  const group = view.container.querySelector(".activity-group")!;
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
