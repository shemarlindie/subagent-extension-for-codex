import assert from "node:assert/strict";

import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import {
  claudeOptions,
  context,
  reply,
  setClaudeOptions,
} from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

const start = (
  writes: { m5?: number; h1?: number },
  reads = 0,
  parent: string | null = null,
) => ({
  type: "stream_event",
  parent_tool_use_id: parent,
  event: {
    type: "message_start",
    message: {
      id: "msg",
      usage: {
        cache_read_input_tokens: reads,
        cache_creation: {
          ephemeral_5m_input_tokens: writes.m5 ?? 0,
          ephemeral_1h_input_tokens: writes.h1 ?? 0,
        },
      },
    },
  },
});

const compaction = {
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: { trigger: "auto", pre_tokens: 1000 },
};

/** Runs a turn that plays `frames`, starting from `previous` if given. */
async function record(frames: object[], previous?: object) {
  const ctx = await context();
  if (previous) setClaudeOptions(ctx.c.task, { prompt_cache: previous });

  const launch = () =>
    Object.assign(
      (async function* () {
        yield* frames;

        yield {
          type: "result",
          subtype: "success",
          result: reply,
          total_cost_usd: 0,
          usage: {},
        };
      })(),
      { close: () => {} },
    ) as unknown as Query;

  const before = Date.now();
  await new ClaudeAgentProvider(launch, readyClaudeCli).run(ctx.c, "Work");

  const stored = claudeOptions(ctx.c.task).prompt_cache as
    { requested_at: string } | undefined;

  if (!stored) return undefined;

  // The time it stores is when this turn's request arrived.
  const { requested_at, ...rest } = stored;
  assert.ok(Date.parse(requested_at) >= before);

  return rest;
}

const recent = new Date().toISOString();
const old = new Date(Date.now() - 2 * 3_600_000).toISOString();

test("a main request records its TTL from its cache writes, and a subagent's records nothing", async () => {
  assert.deepEqual(await record([start({ h1: 10 })]), {
    ttl: "1h",
  });

  assert.equal(await record([start({ m5: 10 }, 0, "toolu_1")]), undefined);
});

test("a request with no writes and compaction keep the previous TTL with a new time", async () => {
  for (const frame of [start({}, 50), compaction]) {
    assert.deepEqual(await record([frame], { requested_at: old, ttl: "5m" }), {
      ttl: "5m",
    });
  }
});

test("a 5m write is partial beside a 1h write or a read of a live 1h record", async () => {
  const partial = { ttl: "5m", partial: true };

  assert.deepEqual(await record([start({ m5: 10, h1: 10 })]), partial);

  assert.deepEqual(
    await record([start({ m5: 10 }, 50)], { requested_at: recent, ttl: "1h" }),
    partial,
  );

  // An expired 1h record leaves only the new 5m cache.
  assert.deepEqual(
    await record([start({ m5: 10 }, 50)], { requested_at: old, ttl: "1h" }),
    { ttl: "5m" },
  );
});
