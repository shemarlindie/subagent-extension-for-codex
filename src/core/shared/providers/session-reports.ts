import { z } from "zod";

/**
 * When the session's latest main request started and how long its prompt
 * cache lives.
 */
export const promptCacheSchema = z.strictObject({
  requested_at: z.iso.datetime(),
  ttl: z.enum(["5m", "1h"]),
});

export type PromptCache = z.infer<typeof promptCacheSchema>;

/**
 * How full the session's context window was after its latest main response.
 * `auto_compact_tokens` is absent when auto-compact is off.
 */
export const contextUsageSchema = z.strictObject({
  total_tokens: z.number().nonnegative(),
  window_tokens: z.number().positive(),
  auto_compact_tokens: z.number().positive().optional(),
  categories: z.array(
    z.strictObject({
      name: z.string(),
      tokens: z.number().positive(),
    }),
  ),
});

export type ContextUsage = z.infer<typeof contextUsageSchema>;
