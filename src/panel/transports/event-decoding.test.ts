import assert from "node:assert/strict";

import { test } from "vitest";

import { eventPayload } from "../../shared/events/payload.js";
import type { Event } from "../app/state/types.js";
import { decodePanelToolResult } from "./event-decoding.js";

const event = (type: string, data: Record<string, unknown>) => ({
  id: 5,
  task_id: "task",
  type,
  timestamp: "2026-10-13T00:00:00.000Z",
  data,
});

test("activity tool pages validate typed views and retain opaque unknown data", () => {
  const page = decodePanelToolResult<{ events: Event[] }>(
    "get_user_agent_activity",
    {
      events: [
        event("agent.reply", { text: "Done", turn: 2, extension: true }),
        event("agent.reply", { text: 7, extension: "retained" }),
        event("vendor.future", { future: true }),
        event("agent.message", {
          role: "assistant",
          message_id: "message-1",
          parent_tool_use_id: null,
          text: "Hello",
        }),
        event("agent.message", {
          text: "Malformed",
          raw_response: { type: "assistant", message: {} },
        }),
        event("agent.content", {
          role: "user",
          message_id: "98e2e423-e9e5-42a1-9477-4a7348deac49",
          parent_tool_use_id: null,
          content: [],
        }),
        event("agent.content", {
          role: "user",
          parent_tool_use_id: null,
          content: [],
        }),
      ],
    },
  );

  const [valid, invalid, future, assistant, incomplete, user, userWithoutId] =
    page.events;

  assert.equal(eventPayload(valid, "agent.reply")?.text, "Done");
  assert.equal(invalid.view?.kind, "opaque");
  assert.equal(invalid.data.extension, "retained");
  assert.equal(future.view?.kind, "opaque");
  assert.equal(future.data.future, true);

  assert.equal(
    eventPayload(assistant, "agent.message")?.message_id,
    "message-1",
  );

  assert.equal(incomplete.view?.kind, "opaque");

  assert.equal(
    (incomplete.data.raw_response as { type: string }).type,
    "assistant",
  );

  assert.equal(
    eventPayload(user, "agent.content")?.message_id,
    "98e2e423-e9e5-42a1-9477-4a7348deac49",
  );

  assert.equal(
    eventPayload(userWithoutId, "agent.content")?.message_id,
    undefined,
  );
});

test("activity page transport rejects malformed envelopes", () => {
  assert.throws(
    () =>
      decodePanelToolResult("get_user_agent_turn_activity", {
        events: [{ type: "task.started", data: {} }],
      }),
    /invalid event envelope/,
  );
});
