// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { task as buildTask } from "../../../app/state/controller-test-harness";
import type { Event as ActivityEvent } from "../../../app/state/types";
import { expandedJsonText } from "../../../shared/components/json-tree/json-tree-test-harness";
import { formatUserDateTime } from "../../../shared/utils/user-date-time";
import { assertAbsent, event, parseHtml } from "./activity-ui-test-harness";
import { EVENT_TAIL_SIZE } from "./event-history";
import { EventList as GroupedEventList } from "./event-list";

/** Fill the event window with progress that renders as one compact row. */
function thinkingWindow(prefix: string) {
  return Array.from({ length: EVENT_TAIL_SIZE }, (_, index) => ({
    ...event("thinking_tokens", { tokens: index + 1 }, `${prefix}-${index}`),
    id: index + 1,
  }));
}

test("the trimmed note summarizes dropped events only for the task being shown", (t) => {
  t.onTestFinished(cleanup);
  const events = thinkingWindow("dropped-note");

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

test("a reply shows its Markdown preview outside Debug with More and Less controls", (t) => {
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

  expect(group.querySelector(".activity-group-secondary")).toBeNull();
  expect(group.querySelector(".activity-debug-body")).toBeNull();

  const responseBody = () =>
    group.querySelector(".activity-body .activity-markdown")!;

  const preview = `${"More detail. ".repeat(6)}More...`;

  expect(responseBody().querySelector("strong")?.textContent).toBe("Done.");
  expect(responseBody().textContent).toContain(preview);
  expect(responseBody().textContent).not.toContain("**");

  const more = group.querySelector<HTMLButtonElement>(
    ".activity-reply-toggle",
  )!;

  expect(more.textContent).toBe("More");
  fireEvent.click(more);
  expect(responseBody().textContent).not.toContain("...");
  expect(responseBody().textContent).toContain("More detail. ".repeat(11));
  expect(more.textContent).toBe("Less");
  fireEvent.click(more);
  expect(responseBody().textContent).toContain(preview);
  expect(more.textContent).toBe("More");

  fireEvent.click(group.querySelector(".activity-debug-toggle")!);
  const debug = group.querySelector(".activity-debug-body")!;
  expect(debug.querySelector(".activity-reply-toggle")).toBeNull();
  expect(debug.querySelector(".activity-text")).toBeNull();

  expect(expandedJsonText(debug.querySelector(".activity-raw")!)).toContain(
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

  const events = thinkingWindow("initial-capacity");

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

test("Activity user messages use literal Chat bubbles and parent messages render Markdown", (t) => {
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
            message: "Follow `up`",
            delivery: "queue",
          },
          "bubble-instruction",
        ),
        event(
          "task.instruction",
          {
            message_id: "parent-brief",
            from: "parent",
            message: "Check `saveUpload` callers",
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
  ).toEqual([text, "Follow `up`"]);

  const parent = view.container.querySelector(
    ".activity-group-summary.activity-markdown",
  )!;

  expect(parent.querySelector("code")?.textContent).toBe("saveUpload");
  expect(parent.textContent).toBe("Check saveUpload callers");

  expect(view.container.querySelector(".chat-bubble strong")).toBeNull();
  expect(view.container.querySelector(".chat-bubble pre")).toBeNull();
  expect(view.container.querySelector(".activity-debug-body")).toBeNull();
  const first = view.container.querySelector(".activity-group")!;
  expect(first.querySelector(":scope > .activity-body")).toBeNull();
  fireEvent.click(first.querySelector(".activity-debug-toggle")!);
  expect(first.querySelector(".activity-debug-body .chat-bubble")).toBeNull();

  expect(expandedJsonText(first.querySelector(".activity-raw")!)).toContain(
    JSON.stringify(text),
  );
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
  const raw = debug.querySelector(".activity-raw")!;
  assert.ok(expandedJsonText(raw)?.includes(result));
  debug.querySelector(".activity-raw")?.remove();
  assert.ok(!debug.textContent?.includes(result));
  expect(debug.querySelector(".activity-reply-toggle")).toBeNull();
});
