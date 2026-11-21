import assert from "node:assert/strict";

import type {
  query,
  SDKControlGetUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import { context, reply } from "./claude-test-harness.js";
import {
  claudePlanUsage,
  ClaudePlanUsage,
  PLAN_USAGE_INTERVAL_MS,
} from "./plan-usage.js";
import { ClaudeAgentProvider } from "./provider.js";

const usage = (fiveHour: number) =>
  ({
    subscription_type: "pro",
    rate_limits_available: true,
    rate_limits: {
      five_hour: {
        utilization: fiveHour,
        resets_at: "2026-11-21T15:40:00.000Z",
      },
      seven_day: { utilization: 18, resets_at: null },
      seven_day_opus: { utilization: 31, resets_at: null },
      model_scoped: [
        { display_name: "Fable", utilization: 7, resets_at: null },
      ],
    },
  }) as unknown as SDKControlGetUsageResponse;

/** A launch whose sessions answer usage calls with `answer`. */
function usageLaunch(answer: () => Promise<SDKControlGetUsageResponse>) {
  const calls = vi.fn(answer);

  const launch = () => ({
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: calls,
    close: () => {},
  });

  return { launch: launch as unknown as typeof query, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

test("plan usage lists each window as a fraction, preferring per-model rows", () => {
  assert.deepEqual(claudePlanUsage(usage(42), 5), {
    plan: "pro",
    windows: [
      {
        id: "five_hour",
        label: "5-hour window",
        utilization: 0.42,
        resetsAt: Date.parse("2026-11-21T15:40:00.000Z") / 1000,
      },
      { id: "seven_day", label: "7-day window", utilization: 0.18 },
      { id: "seven_day_fable", label: "7-day Fable window", utilization: 0.07 },
    ],
    read_at: 5,
  });

  assert.equal(
    claudePlanUsage({
      ...usage(42),
      rate_limits_available: false,
      rate_limits: null,
    }),
    null,
  );
});

test("reads run one at a time, wait for the interval and keep the last value on failure", async () => {
  vi.useFakeTimers();
  let fail = false;
  let percent = 10;

  const { launch, calls } = usageLaunch(async () => {
    if (fail) throw new Error("usage endpoint failed");

    return usage(percent);
  });

  const reader = new ClaudePlanUsage(launch, readyClaudeCli);
  const watcher = vi.fn();

  // Nothing shows a read without a watcher.
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(calls.mock.calls.length, 0);

  reader.watch(watcher);
  assert.equal(reader.current(), undefined);
  // A request while the first read runs is served by one later read.
  reader.refresh();
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(calls.mock.calls.length, 1);
  assert.equal(reader.current()?.windows[0]?.utilization, 0.1);

  percent = 60;
  await vi.advanceTimersByTimeAsync(PLAN_USAGE_INTERVAL_MS - 1);
  assert.equal(calls.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(calls.mock.calls.length, 2);
  assert.equal(reader.current()?.windows[0]?.utilization, 0.6);
  assert.equal(watcher.mock.calls.length, 2);

  fail = true;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(PLAN_USAGE_INTERVAL_MS);
  assert.equal(calls.mock.calls.length, 3);
  assert.equal(reader.current()?.windows[0]?.utilization, 0.6);
  assert.equal(watcher.mock.calls.length, 2);
});

/**
 * Runs a turn on a provider that a watcher follows. With `rateLimited`, the
 * turn sends a rate-limit event and ends only once a read has started.
 */
async function watchedTurn(rateLimited: boolean) {
  const { c } = await context();
  const read = Promise.withResolvers<void>();

  const { launch: usageSession, calls } = usageLaunch(async () => {
    read.resolve();

    return usage(42);
  });

  let turns = 0;

  const launch = (args: Parameters<typeof query>[0]) => {
    // Reading sessions aren't saved; the turn's is.
    if (args.options?.persistSession === false) return usageSession(args);
    turns++;

    return Object.assign(
      (async function* () {
        if (rateLimited) {
          yield {
            type: "rate_limit_event",
            rate_limit_info: { status: "allowed", rateLimitType: "five_hour" },
          };

          await read.promise;
        }

        yield {
          type: "result",
          subtype: "success",
          result: reply,
          total_cost_usd: 0,
          usage: {},
        };
      })(),
      { close: () => {} },
    );
  };

  const provider = new ClaudeAgentProvider(
    launch as unknown as typeof query,
    readyClaudeCli,
  );

  const watcher = vi.fn();
  provider.planUsage.watch(watcher);

  await provider.run(c, "Review");
  await vi.waitFor(() => assert.equal(watcher.mock.calls.length, 1));

  assert.equal(turns, 1);
  assert.equal(calls.mock.calls.length, 1);
  assert.equal(provider.planUsage.current()?.windows[0]?.utilization, 0.42);
}

test("a turn's end reads plan usage for watchers", () => watchedTurn(false));

test("a rate-limit event reads plan usage during the turn", () =>
  watchedTurn(true));
