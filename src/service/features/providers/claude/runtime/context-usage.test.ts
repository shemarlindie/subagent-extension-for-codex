import assert from "node:assert/strict";

import type {
  Query,
  SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import type { RunContext } from "../../types.js";
import {
  claudeOptions,
  context,
  contextUsage,
  reply,
} from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

const responseEnd = (parent: string | null = null) => ({
  type: "stream_event",
  parent_tool_use_id: parent,
  event: { type: "message_delta", delta: { stop_reason: "tool_use" } },
});

const result = {
  type: "result",
  subtype: "success",
  result: reply,
  total_cost_usd: 0,
  usage: {},
};

const compaction = {
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: { trigger: "manual", pre_tokens: 90_000 },
};

/** Answers with `usage` after `ms`. */
const later = (ms: number, usage: SDKControlGetContextUsageResponse) =>
  new Promise<SDKControlGetContextUsageResponse>((resolve) =>
    setTimeout(() => resolve(usage), ms),
  );

type RunOptions = {
  /** Replaces how the run saves session records. */
  sessionOption?: RunContext["sessionOption"];
};

/**
 * Runs a turn that plays `frames`, answering context usage calls with
 * `answer`. As in the SDK, the stream's return fails calls still running.
 */
async function run(
  frames: object[],
  answer: (call: number) => Promise<SDKControlGetContextUsageResponse>,
  { sessionOption }: RunOptions = {},
) {
  const ctx = await context();
  if (sessionOption) ctx.c.sessionOption = sessionOption;
  let calls = 0;
  const closed = Promise.withResolvers<never>();
  closed.promise.catch(() => {});

  const launch = () =>
    Object.assign(
      (async function* () {
        try {
          yield* frames;
          yield result;
        } finally {
          closed.reject(new Error("Query closed before response received"));
        }
      })(),
      {
        close: () => {},
        getContextUsage: () => Promise.race([answer(calls++), closed.promise]),
      },
    ) as unknown as Query;

  await new ClaudeAgentProvider(launch, readyClaudeCli).run(ctx.c, "Work");

  return {
    calls,
    stored: claudeOptions(ctx.c.task).context_usage,
    events: ctx.events,
  };
}

test("a main response stores how full the context window is, and a subagent's measures nothing", async () => {
  const { calls, stored } = await run(
    [responseEnd("tool-1"), responseEnd()],
    async () => contextUsage(40_000),
  );

  assert.equal(calls, 1);

  assert.deepEqual(stored, {
    total_tokens: 40_000,
    window_tokens: 200_000,
    auto_compact_tokens: 167_000,
    categories: [
      { name: "System prompt", tokens: 3_000 },
      { name: "Messages", tokens: 37_000 },
    ],
  });
});

test("the newest measurement wins, and one still running at turn end is stored", async () => {
  // Both answer after the turn has its result, the newer one first.
  const { stored } = await run([responseEnd(), responseEnd()], (call) =>
    call === 0
      ? later(20, contextUsage(40_000))
      : later(10, contextUsage(50_000)),
  );

  assert.equal(
    (stored as { total_tokens: number } | undefined)?.total_tokens,
    50_000,
  );
});

test("compaction stores the context size after it and shows it in its note, though its result follows at once", async () => {
  const { stored, events } = await run([compaction], () =>
    later(10, contextUsage(9_000)),
  );

  assert.equal(
    (stored as { total_tokens: number } | undefined)?.total_tokens,
    9_000,
  );

  const note = events.find((e) => e.data.subtype === "compact_boundary");

  assert.equal(
    note?.data.activity.statusTitle,
    "Context compacted · 90K → 9K tokens",
  );
});

test("a measurement that fails to save leaves the turn to finish", async () => {
  const { calls } = await run(
    [responseEnd()],
    async () => contextUsage(40_000),
    {
      sessionOption: () => {
        throw new Error("database or disk is full");
      },
    },
  );

  assert.equal(calls, 1);
});
