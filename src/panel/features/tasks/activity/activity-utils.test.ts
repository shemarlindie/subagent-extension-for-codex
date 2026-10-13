import assert from "node:assert/strict";

import { test } from "vitest";

import type { Event } from "../../../app/state/types";
import { responsePreview, turnStats } from "./activity-utils";

const completed = (data: Record<string, unknown>): Event => ({
  id: 1,
  task_id: "task",
  type: "agent.completed",
  timestamp: "2026-01-01T00:00:00.000Z",
  data,
});

test("a reply preview stays whole when it is 100 characters", () => {
  const text = "a".repeat(100);

  assert.equal(responsePreview(text), text);
});

test("a longer reply preview keeps its first 100 characters", () => {
  assert.equal(responsePreview(`${"a".repeat(99)} b`), `${"a".repeat(99)}...`);
});

test("a reply preview counts Unicode characters, not UTF-16 units", () => {
  const text = "😀".repeat(101);

  assert.equal(responsePreview(text), `${"😀".repeat(100)}...`);
});

test("turn stats omit numbers the result does not report", () => {
  assert.deepEqual(turnStats(completed({})), []);
  assert.deepEqual(turnStats(completed({ duration_ms: 4000 })), ["4s"]);
});

test("turn stats count cached input and leave non-numbers out", () => {
  const compact = (value: number) =>
    new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);

  assert.deepEqual(
    turnStats(
      completed({
        duration_ms: "soon",
        cost_usd: null,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 2000,
          output_tokens: "many",
        },
      }),
    ),
    [`${compact(3010)} in · ${compact(0)} out tokens`],
  );
});
