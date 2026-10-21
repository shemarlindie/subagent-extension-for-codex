import assert from "node:assert/strict";

import { test } from "vitest";

import { decodedEvent } from "../../../../shared/events/decode";
import type { Event } from "../../../app/state/types";
import { responsePreview, thinkingOnly, turnStats } from "./activity-utils";

const completed = (data: Record<string, unknown>): Event =>
  decodedEvent({
    id: 1,
    task_id: "task",
    type: "agent.completed",
    timestamp: "2026-01-01T00:00:00.000Z",
    data,
  });

test("a reply preview counts Unicode characters, not UTF-16 units", () => {
  const text = "😀".repeat(101);

  assert.equal(responsePreview(text), `${"😀".repeat(100)}...`);
});

test("turn stats omit numbers the result does not report", () => {
  assert.deepEqual(turnStats(completed({})), []);
  assert.deepEqual(turnStats(completed({ duration_ms: 4000 })), ["4s"]);
});

test("turn stats count cached input from the validated payload", () => {
  const compact = (value: number) =>
    new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);

  assert.deepEqual(
    turnStats(
      completed({
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 2000,
          output_tokens: 0,
        },
      }),
    ),
    [`${compact(3010)} in · ${compact(0)} out tokens`],
  );
});

test("thinking-only groups accept an array of thinking blocks", () => {
  const event = decodedEvent({
    id: 2,
    task_id: "task",
    type: "agent.content",
    timestamp: "2026-01-01T00:00:00.000Z",
    data: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "First thought" },
        { type: "thinking", thinking: "Second thought" },
      ],
    },
  });

  assert.equal(thinkingOnly([event]), true);
});
