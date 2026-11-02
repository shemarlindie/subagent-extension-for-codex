// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { expect, test, vi } from "vitest";

import { ControllerContext } from "../../../app/state/controller-context";
import { setup } from "../../../app/state/controller-test-harness";
import { expandedJson } from "../../../shared/components/json-tree/json-tree-test-harness";
import {
  activityMessages,
  assertAbsent,
  event,
  groupCount,
  mockActivityGeometry,
  mockScrollSize,
  stubProperty,
  tooltipText,
} from "./activity-ui-test-harness";
import { EventList as GroupedEventList } from "./event-list";

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
  assert.ok(raw.querySelector(".json-tree"));
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
  assertAbsent(older.querySelector(".json-tree"));

  await waitFor(() => assert.deepEqual(expandedJson(raw), second.data));

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

    assert.deepEqual(expandedJson(raw), second.data);

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

test("new groups animate in and movement animations respect reduced motion", (t) => {
  t.onTestFinished(cleanup);
  mockActivityGeometry();

  let reducedMotion = false;
  let cancellations = 0;

  const calls: {
    element: HTMLElement;
  }[] = [];

  stubProperty(
    t,
    HTMLElement.prototype,
    "animate",
    function (this: HTMLElement) {
      calls.push({ element: this });

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

  const retainedMovement = calls.find((call) => call.element !== newest);

  assert.ok(
    retainedMovement,
    "Existing visible groups animate to their new positions",
  );

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

test("group timings count actual grouping and unchanged props skip the work", (t) => {
  t.onTestFinished(cleanup);
  const { controller } = setup();
  t.onTestFinished(() => controller.dispose());
  const timing = vi.spyOn(controller.timing, "observe");

  const events = [
    event(
      "workspace.indexed",
      { message: "Indexed a file" },
      "timing-index-one",
    ),
    event(
      "workspace.indexed",
      { message: "Indexed a file" },
      "timing-index-two",
    ),
  ];

  const list = (items: typeof events, turn?: number) =>
    createElement(
      ControllerContext.Provider,
      { value: controller },
      createElement(GroupedEventList, { events: items, turn }),
    );

  const view = render(list(events));
  expect(view.container.querySelectorAll(".activity-group")).toHaveLength(1);

  expect(timing).toHaveBeenCalledExactlyOnceWith(
    "activity_latest",
    "group",
    expect.any(Number),
    { rows: 2, groups: 1 },
  );

  view.rerender(list(events));
  expect(timing).toHaveBeenCalledOnce();

  const next = [
    ...events,
    event("agent.message", { text: "Read complete" }, "timing-message"),
  ];

  view.rerender(list(next, 1));
  expect(view.container.querySelectorAll(".activity-group")).toHaveLength(2);
  expect(timing).toHaveBeenCalledTimes(2);

  expect(timing).toHaveBeenLastCalledWith(
    "activity_turn",
    "group",
    expect.any(Number),
    { rows: 3, groups: 2 },
  );
});
