import assert from "node:assert/strict";

import { test } from "vitest";

import { ClaudeAgentProvider } from "../../../service/features/providers/claude/runtime/provider.js";
import type { RunContext } from "../../../service/features/providers/types.js";
import type { Event } from "../../events/types.js";
import {
  currentActivityStatus,
  groupActivity,
} from "../../tasks/activity/activity-timeline.js";
import type { ActivityPresentation } from "./types.js";

function event(id: number, activity: ActivityPresentation): Event {
  return {
    id,
    task_id: "fake-task",
    timestamp: new Date(id * 1000).toISOString(),
    type: "fake.activity",
    data: { activity, native_detail: "retained" },
  };
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

  const groups = groupActivity(events);
  assert.equal(groups[0].title, "Thinking…");
  assert.equal(groups[1].title, "Indexing");
  assert.equal(groups[1].state, "completed");
  assert.deepEqual(groups[1].events, events.slice(1, 3));

  assert.deepEqual(currentActivityStatus(events), {
    text: "Needs input",
    state: "info",
  });

  assert.equal(groups[1].events[0].data.native_detail, "retained");
});

test("Claude emits provider-owned presentation alongside the original SDK response", () => {
  let emitted: Pick<Event, "type" | "data"> | undefined;

  const message = {
    type: "system",
    subtype: "status",
    status: "requesting",
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: "session",
  } as const;

  new ClaudeAgentProvider().normalize(
    {
      emit: (type, data) => {
        emitted = { type, data };
      },
    } as RunContext,
    message,
  );

  assert.ok(emitted);
  assert.equal(emitted.data.raw_response, message);
  const activity = emitted.data.activity as ActivityPresentation;
  // Requesting is a status update, not a thinking signal.
  assert.equal(activity.statusTitle, "Requesting");
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
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "message");
  assert.equal(groups[0].state, "completed");
  assert.deepEqual(groups[0].events, [stream, completed, message]);
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

  assert.equal(groups.length, 3);
  assert.equal(groups[0].title, "Search index");
  assert.equal(groups[0].summary, "Found three routes");
  assert.equal(groups[0].state, "completed");
  assert.equal(groups[1].title, "Index refreshed");
  assert.equal(groups[2].title, "Cache refreshed");
});
