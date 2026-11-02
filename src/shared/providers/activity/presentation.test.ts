import assert from "node:assert/strict";

import { test } from "vitest";

import { claudeMessageNormalizer } from "../../../service/features/providers/claude/events/normalize.js";
import type { RunContext } from "../../../service/features/providers/types.js";
import { decodedEvent } from "../../events/decode.js";
import type { Event } from "../../events/types.js";
import { currentActivityStatus } from "../../tasks/activity/activity-status.js";
import { groupActivity } from "../../tasks/activity/activity-timeline.js";
import { activityPresentation } from "./presentation.js";
import type { ActivityPresentation, ActivityStreamAppend } from "./types.js";

function streamAppendTypes() {
  const valid: ActivityPresentation = {
    stream: {
      id: "stream",
      update: {
        index: 0,
        append: {
          field: "thinking",
          type: "thinking",
          text: "Checking",
        },
      },
    },
  };

  // @ts-expect-error stream append fields must describe the same block
  const invalid: ActivityStreamAppend = {
    field: "text",
    type: "thinking",
    text: "Checking",
  };

  void valid;
  void invalid;
}

void streamAppendTypes;

function event(id: number, activity: ActivityPresentation): Event {
  return decodedEvent({
    id,
    task_id: "fake-task",
    timestamp: new Date(id * 1000).toISOString(),
    type: "fake.activity",
    data: { activity, native_detail: "retained" },
  });
}

test("a provider can present thinking, operations and session status without SDK events", () => {
  const events = [
    event(1, { kind: "planning", thinking: true, statusTitle: "Thinking…" }),
    event(2, {
      operation: {
        id: "index",
        kind: "operation",
        title: "Indexing",
        started: true,
      },
    }),
    event(3, {
      operation: {
        id: "index",
        kind: "operation",
        title: "Indexing",
        completed: true,
      },
    }),
    event(4, {
      kind: "session",
      quiet: true,
      statusTitle: "Needs input",
      statusState: "info",
    }),
  ];

  const [thinking, indexing] = groupActivity(events);
  assert.ok(thinking && indexing);
  assert.equal(thinking.title, "Thinking…");
  assert.equal(indexing.title, "Indexing");
  assert.equal(indexing.state, "completed");
  assert.deepEqual(indexing.events, events.slice(1, 3));

  assert.deepEqual(currentActivityStatus(events), {
    text: "Needs input",
    state: "info",
  });

  const [indexed] = indexing.events;
  assert.ok(indexed);
  assert.equal(indexed.data.native_detail, "retained");
});

test("Claude emits provider-owned presentation alongside the original SDK response", () => {
  let rawResponse: unknown;
  let emittedActivity: unknown;

  const message = {
    type: "system",
    subtype: "status",
    status: "requesting",
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: "session",
  } as const;

  claudeMessageNormalizer(true)(
    {
      emit: () => {},
      emitOpaque: (_type: string, data: Record<string, unknown>) => {
        rawResponse = data.raw_response;
        emittedActivity = data.activity;
      },
    } as unknown as RunContext,
    message,
  );

  assert.equal(rawResponse, message);
  const activity = emittedActivity as ActivityPresentation;
  // Requesting is a status update, not a thinking signal.
  assert.equal(activity.thinking, false);
});

test("a provider can associate streams and messages using normalized identities", () => {
  const stream = event(1, {
    stream: { id: "reply", messageId: "message", started: true },
  });

  const completed = event(2, { stream: { id: "reply", completed: true } });

  const message = {
    ...event(3, { messageId: "message", hasThinking: false }),
    type: "agent.message",
  };

  message.data.text = "Reply";
  const groups = groupActivity([stream, completed, message]);
  const [group] = groups;
  assert.equal(groups.length, 1);
  assert.ok(group);
  assert.equal(group.kind, "message");
  assert.equal(group.state, "completed");
  assert.deepEqual(group.events, [stream, completed, message]);
});

test("invalid normalized presentation is not exposed to activity consumers", () => {
  const invalid = decodedEvent({
    id: 1,
    task_id: "fake-task",
    timestamp: "2026-10-13T00:00:00.000Z",
    type: "fake.activity",
    data: {
      activity: {
        kind: "stream",
        stream: { id: "reply", content: { type: "text", text: 42 } },
      },
    },
  });

  assert.equal(invalid.presentation, undefined);
  assert.deepEqual(activityPresentation(invalid), {});
});

test("normalized tool and event labels appear in timeline groups", () => {
  const tool = event(1, {
    operation: {
      id: "lookup",
      kind: "tool",
      title: "Search index",
      summary: "Authentication routes",
      started: true,
    },
  });

  const complete = event(2, {
    operation: {
      id: "lookup",
      kind: "tool",
      title: "Search index",
      summary: "Found three routes",
      completed: true,
    },
  });

  const note = event(3, { title: "Index refreshed", summary: "Ready" });
  const otherNote = event(4, { title: "Cache refreshed", summary: "Ready" });
  const groups = groupActivity([tool, complete, note, otherNote]);

  const [search] = groups;
  assert.ok(search);

  assert.deepEqual(
    groups.map((group) => group.title),
    ["Search index", "Index refreshed", "Cache refreshed"],
  );

  assert.equal(search.summary, "Found three routes");
  assert.equal(search.state, "completed");
});
