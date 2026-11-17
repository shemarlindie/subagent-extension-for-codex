import type {
  Query,
  SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";

import type { ClaudeContextUsage } from "../../../../../shared/providers/claude/task-options.js";
import { logError, logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";

/** How long a turn's end waits for a measurement still running. */
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
  let settled = false;
  let running: Promise<void> | undefined;

  const measure = () => {
    const id = ++started;
    const begun = performance.now();

    running = stream
      .getContextUsage({ detail: "summary" })
      .then((usage) => {
        if (settled || id < stored) return;
        stored = id;

        const record = contextUsageRecord(usage);
        c.sessionOption("context_usage", record);

        logEvent("debug", "provider.context_usage", {
          total_tokens: record.total_tokens,
          window_tokens: record.window_tokens,
          duration_ms: performance.now() - begun,
        });
      })
      // A failed call or save only loses this measurement.
      .catch((error: unknown) => {
        if (!settled) logError("provider.context_usage_failed", error);
      });
  };

  /** Waits briefly for a measurement still running, then stores no more. */
  const settle = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timedOut =
      running &&
      (await Promise.race([
        running.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), SETTLE_MS);
        }),
      ]));

    clearTimeout(timer);
    settled = true;

    if (timedOut) logEvent("warn", "provider.context_usage_timeout");
  };

  return { measure, settle };
}
