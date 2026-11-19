import type {
  Query,
  SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";

import type { ClaudeContextUsage } from "../../../../../shared/providers/claude/task-options.js";
import { logError, logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";

/** How long a turn waits for a measurement still running. */
const SETTLE_MS = 2_000;

function contextUsageRecord(
  usage: SDKControlGetContextUsageResponse,
): ClaudeContextUsage {
  return {
    total_tokens: usage.totalTokens,
    window_tokens: usage.rawMaxTokens,
    ...(usage.isAutoCompactEnabled && usage.autoCompactThreshold
      ? { auto_compact_tokens: usage.autoCompactThreshold }
      : {}),
    categories: usage.categories
      .filter(({ kind, tokens }) => kind === "used" && tokens > 0)
      .map(({ name, tokens }) => ({ name, tokens })),
  };
}

/**
 * Measures how full the session's context window is, as `/context` reports
 * it, and stores the newest result. `summary` answers from the last response's
 * usage and local estimates, with no API call, so a measurement after each
 * main response is current until the next request.
 *
 * Measurements run in the background. A result that arrives after a newer
 * one's is dropped, and none is stored once the turn has settled.
 */
export function contextUsageRecorder(
  c: RunContext,
  stream: Pick<Query, "getContextUsage">,
) {
  let started = 0;
  let stored = 0;
  // Measurements up to this one store nothing more: they were given up on.
  let dropped = 0;
  let running: Promise<ClaudeContextUsage | undefined> | undefined;

  /** Starts a measurement, which resolves with the record it stores. */
  const measure = () => {
    const id = ++started;
    const begun = performance.now();

    running = stream
      .getContextUsage({ detail: "summary" })
      .then((usage) => {
        if (id <= dropped || id < stored) return undefined;
        stored = id;

        const record = contextUsageRecord(usage);
        c.sessionOption("context_usage", record);

        logEvent("debug", "provider.context_usage", {
          total_tokens: record.total_tokens,
          window_tokens: record.window_tokens,
          duration_ms: performance.now() - begun,
        });

        return record;
      })
      // A failed call or save only loses this measurement.
      .catch((error: unknown) => {
        if (id > dropped) logError("provider.context_usage_failed", error);

        return undefined;
      });
  };

  /**
   * Waits up to `SETTLE_MS` for the latest measurement. One that takes longer
   * is dropped with any before it, so a late answer can't change the meter
   * after the turn has moved on, and nothing waits for it again.
   */
  const wait = async () => {
    if (!running) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol("timed out");

    const result = await Promise.race([
      running,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), SETTLE_MS);
      }),
    ]);

    clearTimeout(timer);
    if (result !== timedOut) return result;

    dropped = started;
    running = undefined;
    logEvent("warn", "provider.context_usage_timeout");

    return undefined;
  };

  /** Measures now and waits briefly for the record it stores. */
  const measureNow = () => {
    measure();

    return wait();
  };

  /**
   * Waits briefly for a measurement still running, then stores no more. It
   * must run before the stream closes, which fails a pending measurement.
   */
  const settle = async () => {
    await wait();
    dropped = started;
  };

  return { measure, measureNow, settle };
}
