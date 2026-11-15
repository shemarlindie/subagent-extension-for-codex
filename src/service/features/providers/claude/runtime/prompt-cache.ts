import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

import {
  type ClaudePromptCache,
  readClaudeTaskOptions,
} from "../../../../../shared/providers/claude/task-options.js";
import { logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";

const HOUR_MS = 3_600_000;

type MessageStart = Extract<
  SDKPartialAssistantMessage["event"],
  { type: "message_start" }
>;

type CacheUsage = Partial<
  Pick<
    MessageStart["message"]["usage"],
    "cache_creation" | "cache_read_input_tokens"
  >
>;

type Lifetime = Omit<ClaudePromptCache, "requested_at">;

/**
 * The lifetime a request's cache writes name. The API puts 1h entries before
 * 5m ones, so a 5m write after a live 1h record leaves the earlier
 * conversation cached longer than the tail. No writes keep the previous one.
 */
function lifetime(
  counts: { writes5m: number; writes1h: number; reads: number },
  previous: ClaudePromptCache | undefined,
  now: number,
): Lifetime | undefined {
  if (counts.writes5m) {
    // Only a 1h part still alive can outlast the tail.
    const hourLeft =
      !!previous &&
      (previous.ttl === "1h" || !!previous.partial) &&
      Date.parse(previous.requested_at) + HOUR_MS > now;

    const partial = !!counts.writes1h || (!!counts.reads && hourLeft);

    return { ttl: "5m", ...(partial ? { partial } : {}) };
  }

  if (counts.writes1h) return { ttl: "1h" };
  if (!previous) return undefined;

  return { ttl: previous.ttl, ...(previous.partial ? { partial: true } : {}) };
}

/**
 * Records a main request's start and the lifetime of its cache. Every read
 * refreshes the cache, so expiry follows the latest request. Compaction
 * reports no usage and keeps the previous lifetime.
 */
export function recordPromptCache(
  c: RunContext,
  trigger: "message_start" | "compact_boundary",
  usage?: CacheUsage,
) {
  const now = Date.now();

  const counts = {
    writes5m: usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    writes1h: usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    reads: usage?.cache_read_input_tokens ?? 0,
  };

  const next = lifetime(
    counts,
    readClaudeTaskOptions(c.task).prompt_cache,
    now,
  );

  logEvent("debug", "provider.prompt_cache", {
    trigger,
    ttl: next?.ttl,
    partial: next?.partial,
    cache_read_tokens: counts.reads,
    cache_write_5m_tokens: counts.writes5m,
    cache_write_1h_tokens: counts.writes1h,
  });

  // No writes and no earlier record leave the TTL unknown.
  if (!next) return;

  c.promptCache({
    requested_at: new Date(now).toISOString(),
    ...next,
  } satisfies ClaudePromptCache);
}
