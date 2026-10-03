import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import type { Event as ActivityEvent } from "../ui/core/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MutationObserver",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: (dom.window as any)[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { render, cleanup, act, waitFor, fireEvent } =
  await import("@testing-library/react");
const { EventDetails: EventList, EventList: GroupedEventList } =
  await import("../ui/components/event-list");
const { ActivityContent, ActivityValue } =
  await import("../ui/components/activity-content");

const eventIds = new Map<string, number>();
const { default: userEvent } = await import("@testing-library/user-event");

function event(
  type: string,
  data: Record<string, unknown>,
  id = "one",
): ActivityEvent {
  if (!eventIds.has(id)) eventIds.set(id, eventIds.size + 1);
  return {
    id: eventIds.get(id)!,
    task_id: "task",
    timestamp: "2026-10-02T12:00:00.000Z",
    type,
    data,
  };
}
// assert.equal(element, null) diffs the whole jsdom object graph on failure,
// which never finishes and starves waitFor's timeout.
function assertAbsent(element: Element | null, message = "Unexpected element") {
  assert.ok(
    element === null,
    `${message}: ${element?.outerHTML.slice(0, 200)}`,
  );
}
function markup(events: ActivityEvent[]) {
  const html = renderToStaticMarkup(createElement(EventList, { events }));
  return new JSDOM(html).window.document;
}

// Model real document flow: each activity occupies 100px after the status row.
// Reordering or prepending DOM nodes changes their measured position automatically.
function mockActivityGeometry(t: TestContext) {
  t.mock.method(
    HTMLElement.prototype,
    "getBoundingClientRect",
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

function activityMessages(prefix: string, count = 4) {
  return Array.from({ length: count }, (_, i) =>
    event(
      "agent.message",
      { text: `${prefix} message ${i}` },
      `${prefix}-${i}`,
    ),
  );
}

test("latest group is first and fresh progress moves an older tool to the top without resetting inspection", (t) => {
  t.after(cleanup);
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
  assert.match(groups()[0].textContent ?? "", /Newer message/);
  const tool = groups()[1];
  const debug = view.getByRole("button", { name: "Debug activity: Read" });
  fireEvent.click(debug);
  const raw = tool.querySelector("details.activity-raw") as HTMLDetailsElement;
  act(() => {
    raw.open = true;
    raw.dispatchEvent(new dom.window.Event("toggle"));
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
  assert.equal(groups()[0], tool, "The updated group moves without remounting");
  assert.ok(
    Array.from(tool.querySelectorAll("details.activity-raw")).includes(raw),
    "The original response inspector survives newly prepended debug events",
  );
  assert.equal(raw.open, true);
  assert.ok(raw.querySelector("pre"));
  assert.equal(debug.getAttribute("aria-expanded"), "true");
});

test("artifact counts update without closing debug or remounting raw inspectors", async (t) => {
  t.after(cleanup);
  const events = [1, 2, 3].map((index) =>
    event(
      "artifact.created",
      { title: `Artifact ${index}` },
      `count-artifact-${index}`,
    ),
  );
  const view = render(
    createElement(GroupedEventList, { events: events.slice(0, 1) }),
  );
  const debug = view.getByRole("button", {
    name: "Debug activity: Created an artifact",
  });
  fireEvent.click(debug);
  const panel = document.getElementById(debug.getAttribute("aria-controls")!)!;
  const raw = panel.querySelector("details.activity-raw") as HTMLDetailsElement;
  await act(async () => {
    raw.open = true;
    raw.dispatchEvent(new dom.window.Event("toggle"));
  });
  await waitFor(() =>
    assert.equal(
      raw.querySelector("pre")?.textContent,
      JSON.stringify(events[0].data, null, 2),
    ),
  );
  for (const count of [2, 3]) {
    view.rerender(
      createElement(GroupedEventList, { events: events.slice(0, count) }),
    );
    assert.equal(
      view.getByRole("button", {
        name: `Debug activity: Created ${count} artifacts`,
      }),
      debug,
    );
    assert.equal(debug.getAttribute("aria-expanded"), "true");
    assert.equal(debug.getAttribute("title"), `Inspect ${count} raw responses`);
    assert.equal(panel.hidden, false);
    const inspectors = Array.from(
      panel.querySelectorAll("details.activity-raw"),
    );
    assert.equal(inspectors.length, count);
    assert.ok(inspectors.includes(raw));
    assert.equal(raw.open, true);
    assert.equal(
      raw.querySelector("pre")?.textContent,
      JSON.stringify(events[0].data, null, 2),
    );
    assert.equal(view.container.querySelectorAll(".activity-group").length, 1);
  }
});

test("pinned updates stay at zero and manually returning within the 48px buffer repins", (t) => {
  t.after(cleanup);
  mockActivityGeometry(t);
  const initial = activityMessages("pin-buffer");
  const view = render(createElement(GroupedEventList, { events: initial }));
  const viewport = view.getByRole("region", { name: "Activity history" });
  const fab = () =>
    view.queryByRole("button", { name: "Scroll to latest activity" });
  assert.equal(viewport.scrollTop, 0);
  assertAbsent(fab());
  viewport.scrollTop = 30;
  const next = [...initial, ...activityMessages("pin-buffer-next", 1)];
  view.rerender(createElement(GroupedEventList, { events: next }));
  assert.equal(
    viewport.scrollTop,
    0,
    "Pinned updates undo browser scroll anchoring",
  );
  viewport.scrollTop = 49;
  fireEvent.scroll(viewport);
  assert.ok(fab(), "Beyond the buffer, the reader controls scrolling");
  viewport.scrollTop = 48;
  fireEvent.scroll(viewport);
  assertAbsent(fab(), "The edge of the buffer repins");
  view.rerender(
    createElement(GroupedEventList, {
      events: [...next, ...activityMessages("pin-buffer-last", 1)],
    }),
  );
  assert.equal(viewport.scrollTop, 0);
});

test("scroll to latest FAB returns to zero and keeps subsequent activity pinned", (t) => {
  t.after(cleanup);
  mockActivityGeometry(t);
  const initial = activityMessages("fab-pin");
  const view = render(createElement(GroupedEventList, { events: initial }));
  const viewport = view.getByRole("region", { name: "Activity history" });
  viewport.scrollTop = 240;
  fireEvent.scroll(viewport);
  fireEvent.click(
    view.getByRole("button", { name: "Scroll to latest activity" }),
  );
  assert.equal(viewport.scrollTop, 0);
  assert.ok(
    document.activeElement === viewport,
    "Focus returns to the activity region when the FAB disappears",
  );
  assertAbsent(
    view.queryByRole("button", { name: "Scroll to latest activity" }),
  );
  view.rerender(
    createElement(GroupedEventList, {
      events: [...initial, ...activityMessages("fab-pin-next", 1)],
    }),
  );
  assert.equal(viewport.scrollTop, 0);
});

test("new activity preserves the visible reader anchor while unpinned", (t) => {
  t.after(cleanup);
  mockActivityGeometry(t);
  const initial = activityMessages("reader-anchor");
  const view = render(createElement(GroupedEventList, { events: initial }));
  const viewport = view.getByRole("region", { name: "Activity history" });
  viewport.scrollTop = 175;
  fireEvent.scroll(viewport);
  const anchor =
    view.container.querySelectorAll<HTMLElement>(".activity-group")[1];
  const before = anchor.getBoundingClientRect().top;
  view.rerender(
    createElement(GroupedEventList, {
      events: [...initial, ...activityMessages("reader-anchor-next", 1)],
    }),
  );
  assert.equal(anchor.getBoundingClientRect().top, before);
  assert.equal(
    viewport.scrollTop,
    275,
    "Compensate for the prepended 100px group",
  );
  assert.ok(view.getByRole("button", { name: "Scroll to latest activity" }));
});

test("new activity preserves a reader scroll before its scroll event fires", (t) => {
  t.after(cleanup);
  mockActivityGeometry(t);
  const initial = activityMessages("reader-scroll-race");
  const view = render(createElement(GroupedEventList, { events: initial }));
  const viewport = view.getByRole("region", { name: "Activity history" });
  viewport.scrollTop = 175;
  const anchor =
    view.container.querySelectorAll<HTMLElement>(".activity-group")[1];
  const before = anchor.getBoundingClientRect().top;

  view.rerender(
    createElement(GroupedEventList, {
      events: [...initial, ...activityMessages("reader-scroll-race-next", 1)],
    }),
  );

  assert.equal(anchor.getBoundingClientRect().top, before);
  assert.equal(viewport.scrollTop, 275);
  assert.ok(view.getByRole("button", { name: "Scroll to latest activity" }));
});

test("new groups animate in and movement animations respect reduced motion", (t) => {
  t.after(cleanup);
  mockActivityGeometry(t);
  const previousAnimate = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );
  const previousMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );
  let reducedMotion = false;
  let cancellations = 0;
  const calls: {
    element: HTMLElement;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
  }[] = [];
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(
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
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: reducedMotion }),
  });
  t.after(() => {
    if (previousAnimate)
      Object.defineProperty(HTMLElement.prototype, "animate", previousAnimate);
    else delete (HTMLElement.prototype as any).animate;
    if (previousMatchMedia)
      Object.defineProperty(window, "matchMedia", previousMatchMedia);
    else delete (window as any).matchMedia;
  });
  const initial = activityMessages("animation", 2);
  const view = render(createElement(GroupedEventList, { events: [] }));
  const viewport = view.getByRole("region", { name: "Activity history" });
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: 300,
  });
  view.rerender(createElement(GroupedEventList, { events: initial }));
  assert.equal(
    calls.length,
    2,
    "First activity arriving in an empty feed animates",
  );
  calls.length = 0;
  viewport.scrollTop = 30;
  fireEvent.scroll(viewport);
  const next = [...initial, ...activityMessages("animation-next", 1)];
  view.rerender(createElement(GroupedEventList, { events: next }));
  const newest = view.container.querySelector(".activity-group");
  const entrance = calls.find((call) => call.element === newest);
  assert.ok(
    entrance,
    "A newly inserted visible group receives an entrance animation",
  );
  assert.equal(entrance.frames[0].opacity, 0);
  assert.equal(entrance.frames[1].opacity, 1);
  assert.equal(entrance.frames[1].transform, "translateY(0)");
  assert.ok(Number(entrance.options.duration) > 0);
  const retainedMovement = calls.find((call) => call.element !== newest);
  assert.ok(
    retainedMovement,
    "Existing visible groups animate to their new positions",
  );
  assert.equal(retainedMovement.frames[0].transform, "translateY(-130px)");
  assert.equal(retainedMovement.frames[0].opacity, 1);
  const cancelledBeforeScroll = cancellations;
  fireEvent.scroll(viewport);
  assert.equal(
    cancellations,
    cancelledBeforeScroll,
    "Restoring the top must not cancel new animations",
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
for (const [type, subtype, title] of families) {
  test(`activity UI presents ${subtype ?? type} with friendly fields and raw inspection`, () => {
    const raw = {
      type,
      ...(subtype ? { subtype } : {}),
      extra_details: {
        item_count: 0,
        enabled: false,
        description: "Readable detail",
      },
      uuid: "raw-only-id",
    };
    const doc = markup([
      event("claude.activity", { ...raw, raw_response: raw }),
    ]);
    assert.equal(doc.querySelector("strong")?.textContent, title);
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
}

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
  ])
    assert.ok(text.includes(snippet), snippet);
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
  ])
    assert.ok(doc.body.textContent?.includes(snippet), snippet);
});

test("opening raw response shows the original full JSON and preserves disclosure through refresh", async (t) => {
  t.after(cleanup);
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
    details.dispatchEvent(new dom.window.Event("toggle"));
  });
  await waitFor(() =>
    assert.equal(
      details.querySelector("pre")?.textContent,
      JSON.stringify(raw, null, 2),
    ),
  );
  view.rerender(createElement(EventList, { events: [{ ...activity }] }));
  assert.equal(view.container.querySelector("details.activity-raw"), details);
  assert.equal(details.open, true);
  assert.equal(
    details.querySelector("pre")?.textContent,
    JSON.stringify(raw, null, 2),
  );
  assertAbsent(view.container.querySelector("script"));
  await act(async () => {
    details.open = false;
    details.dispatchEvent(new dom.window.Event("toggle"));
  });
  await waitFor(() => assertAbsent(details.querySelector("pre")));
});

test("legacy events expose their entire data when no original SDK response exists", async (t) => {
  t.after(cleanup);
  const data = {
    text: "Legacy event",
    enabled: false,
    count: 0,
    nested: [null],
  };
  const view = render(
    createElement(EventList, { events: [event("agent.message", data)] }),
  );
  const details = view.container.querySelector(
    "details.activity-raw",
  ) as HTMLDetailsElement;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new dom.window.Event("toggle"));
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
  ])
    assert.ok(text.includes(snippet), snippet);
  assert.ok(!text.includes("private-encoded-svg"));
  assert.ok(!text.includes("private-encoded-pdf"));
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 3);
});

test("grouped tool activity retains individual raw inspections while progress refreshes", async (t) => {
  t.after(cleanup);
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
    raw.dispatchEvent(new dom.window.Event("toggle"));
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

test("grouped streams accumulate readable blocks and preserve every frame for inspection", () => {
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
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll(".activity-group").length, 1);
  const content = doc.querySelector(".activity-stream > .activity-body");
  assert.match(content?.textContent ?? "", /Hello world/);
  assert.match(content?.textContent ?? "", /Checking evidence/);
  assert.match(content?.textContent ?? "", /\{"file_path":"a.ts"\}/);
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 0);
  assert.equal(
    doc.querySelector("button.activity-debug-toggle")?.getAttribute("title"),
    "Inspect 10 raw responses",
  );
  assert.equal(
    doc.querySelector(".activity-debug-panel")?.hasAttribute("hidden"),
    true,
  );
});

test("final SDK message replaces provisional stream fragments in the main conversation", () => {
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
  const doc = new JSDOM(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  ).window.document;
  assert.equal(doc.querySelectorAll(".activity-group").length, 1);
  const content = doc.querySelector(".activity-message > .activity-body");
  assert.equal(content?.textContent, "Final response");
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 0);
});

test("a compact accessible debug toggle hides inspection until opened and preserves raw state", async (t) => {
  t.after(cleanup);
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
  assert.equal(toggle.getAttribute("title"), "Inspect 1 raw response");
  assert.ok(toggle.classList.contains("activity-debug-toggle"));
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  assert.ok(panel.classList.contains("activity-debug-panel"));
  assert.equal(panel.hidden, true);
  assertAbsent(view.queryByText("Raw response", { selector: "summary" }));
  assertAbsent(
    panel.querySelector(".event"),
    "Individual debug events mount only after first activation",
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
  assert.ok(
    document.activeElement === toggle,
    "Native debug button participates in keyboard focus",
  );
  await userEvent.setup({ document: dom.window.document }).keyboard("{Enter}");
  assert.equal(panel.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const raw = panel.querySelector("details.activity-raw") as HTMLDetailsElement;
  assertAbsent(raw.querySelector("pre"));
  await act(async () => {
    raw.open = true;
    raw.dispatchEvent(new dom.window.Event("toggle"));
  });
  await waitFor(() =>
    assert.equal(
      raw.querySelector("pre")?.textContent,
      JSON.stringify(activity.data.raw_response, null, 2),
    ),
  );
  view.rerender(createElement(GroupedEventList, { events: [{ ...activity }] }));
  assert.ok(
    view.getByRole("button", { name: "Debug activity: Assistant" }) === toggle,
    "Debug toggle keeps its identity",
  );
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
  const doc = new JSDOM(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  ).window.document;
  const summaries = Array.from(
    doc.querySelectorAll(".activity-group-summary"),
  ).map((node) => node.textContent);
  assert.ok(summaries.includes("Visible hook stderr"));
  assert.ok(summaries.some((text) => text?.includes("Visible tool error")));
  assert.equal(
    doc.querySelectorAll(".activity-group.activity-error").length,
    2,
  );
});

test("cancelled and stopped grouped operations never display Done badges", () => {
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
    event(
      "claude.activity",
      { type: "system", subtype: "task_started", task_id: "stopped-task" },
      "stopped-task-start",
    ),
    event(
      "claude.activity",
      {
        type: "system",
        subtype: "task_notification",
        task_id: "stopped-task",
        status: "stopped",
      },
      "stopped-task-finish",
    ),
    event(
      "claude.activity",
      { type: "system", subtype: "task_started", task_id: "killed-task" },
      "killed-task-start",
    ),
    event(
      "claude.activity",
      {
        type: "system",
        subtype: "task_updated",
        task_id: "killed-task",
        patch: { status: "killed" },
      },
      "killed-task-finish",
    ),
  ];
  const doc = new JSDOM(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  ).window.document;
  assert.equal(doc.querySelectorAll(".activity-group").length, 3);
  assert.equal(doc.querySelectorAll(".activity-badge").length, 0);
  const summaries = Array.from(
    doc.querySelectorAll(".activity-group-summary"),
  ).map((node) => node.textContent ?? "");
  assert.equal(
    summaries.filter((text) => text.startsWith("Cancelled")).length,
    1,
  );
  assert.equal(
    summaries.filter((text) => text.startsWith("Stopped")).length,
    2,
  );
});

test("tool result image previews and individual responses mount on first debug activation", (t) => {
  t.after(cleanup);
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
  assert.equal(panel.querySelector("img.activity-image"), image);
  view.rerender(createElement(GroupedEventList, { events: [...events] }));
  assert.equal(panel.hidden, true);
  assert.equal(panel.querySelector("img.activity-image"), image);
  fireEvent.click(toggle);
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector("img.activity-image"), image);
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
  return new JSDOM(
    renderToStaticMarkup(createElement(ActivityContent, { content })),
  ).window.document;
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
  const doc = new JSDOM(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  ).window.document;
  const blocks = Array.from(
    doc.querySelectorAll(".activity-stream > .activity-body p.activity-text"),
    (node) => node.textContent,
  );
  assert.deepEqual(blocks, ["Default block remains", "Second block"]);
});
