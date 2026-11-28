import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

import type { RunContext } from "../../../../core/service/features/providers/types.js";
import { logEvent } from "../../../../core/service/platform/logging/logger.js";
import {
  readClaudeTaskOptions,
  type ClaudePromptCache,
} from "../../shared/task-options.js";

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

/**
 * Records a main request's start and the TTL its cache writes name. Every read
 * refreshes the cache, so expiry follows the latest request. A request that
 * only reads, and compaction, which reports no usage, keep the previous TTL. A
 * request that neither reads nor writes didn't use the cache, so the record
 * stays as it was.
 *
 * After a drop from 1h to 5m, the older 1h part stays reachable only while
 * the conversation since is short, so the record follows the 5m tail.
 */
export function recordPromptCache(
  c: RunContext,
  trigger: "message_start" | "compact_boundary",
  usage?: CacheUsage,
) {
  const reads = usage?.cache_read_input_tokens ?? 0;
  const writes5m = usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const writes1h = usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0;

  const used =
    trigger === "compact_boundary" || reads > 0 || writes5m > 0 || writes1h > 0;

  let ttl = readClaudeTaskOptions(c.task).prompt_cache?.ttl;
  if (writes1h) ttl = "1h";
  if (writes5m) ttl = "5m";

  logEvent("debug", "provider.prompt_cache", {
    trigger,
    used,
    ttl,
    cache_read_tokens: reads,
    cache_write_5m_tokens: writes5m,
    cache_write_1h_tokens: writes1h,
  });

  // A read with no earlier record leaves the TTL unknown.
  if (!used || !ttl) return;

  c.sessionOption("prompt_cache", {
    requested_at: new Date().toISOString(),
    ttl,
  } satisfies ClaudePromptCache);
}
