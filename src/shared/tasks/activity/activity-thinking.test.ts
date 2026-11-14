import assert from "node:assert/strict";

import { test } from "vitest";

import { groupActivity } from "./activity-timeline.js";
import { thinkingSpan } from "./activity-timeline.js";
import { event, sdk } from "./activity-timeline-test-harness.js";

test("a thinking row is open-ended when no event follows", () => {
  const thinking = [event(10, "thinking_tokens"), event(14, "thinking_tokens")];
  const [group] = groupActivity(thinking);
  assert.ok(group);

  assert.deepEqual(thinkingSpan(group, thinking), {
    start: 10000,
    end: null,
  });
});

test("a message that absorbed its thinking marker spans marker to message", () => {
  const raw = { message: { id: "m1" } };

  const events = [
    event(5, "thinking_tokens", { tokens: 10 }),
    event(9, "agent.message", { text: "Done", raw_response: raw }),
    event(5.5, "agent.message", {
      content: [{ type: "thinking", thinking: "hm" }],
      raw_response: raw,
    }),
  ];

  const message = groupActivity(events).find((g) => g.kind === "message");
  assert.ok(message);
  const span = thinkingSpan(message, events);
  assert.ok(span && span.end !== null && span.end > span.start);
});

test("startup and ordinary statuses remain visible beside a thinking row", () => {
  const events = [
    event(10, "agent.started"),
    sdk(11, "status", { status: null }),
    event(12, "thinking_tokens", { tokens: 10 }),
    event(20, "tool.started", { id: "a", name: "Read" }),
  ];

  const groups = groupActivity(events);
  const group = groups.find((g) => g.title === "Thinking…");
  assert.ok(group);

  assert.deepEqual(
    groups.map((group) => group.events.map((event) => event.id)),
    [[10], [11], [12], [20]],
  );

  const [connected, working] = groups;
  assert.ok(connected && working);

  assert.equal(thinkingSpan(connected, events), undefined);
  assert.equal(thinkingSpan(working, events), undefined);
  assert.deepEqual(thinkingSpan(group, events), { start: 12000, end: 20000 });
});
