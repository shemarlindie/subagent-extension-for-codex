import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

import {
  type ClaudePromptCache,
  readClaudeTaskOptions,
} from "../../../../../shared/providers/claude/task-options.js";
import { logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";

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
 * writes nothing, such as compaction, keeps the previous TTL.
 *
 * After a drop from 1h to 5m, the older 1h part stays reachable only while
 * the conversation since is short, so the record follows the 5m tail.
 */
export function recordPromptCache(
  c: RunContext,
  trigger: "message_start" | "compact_boundary",
  usage?: CacheUsage,
) {
  const writes5m = usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const writes1h = usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  let ttl = readClaudeTaskOptions(c.task).prompt_cache?.ttl;
  if (writes1h) ttl = "1h";
  if (writes5m) ttl = "5m";

  logEvent("debug", "provider.prompt_cache", {
    trigger,
    ttl,
    cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
    cache_write_5m_tokens: writes5m,
    cache_write_1h_tokens: writes1h,
  });

  // No writes and no earlier record leave the TTL unknown.
  if (!ttl) return;

  c.promptCache({
    requested_at: new Date().toISOString(),
    ttl,
  } satisfies ClaudePromptCache);
}
