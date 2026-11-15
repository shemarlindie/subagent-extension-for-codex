import type { TaskView } from "../../tasks/model.js";
import { optionsForProvider } from "../options.js";
import { claudeTaskOptionsSchema } from "./task-options.js";

const MINUTE_MS = 60_000;
const TTL_MS = { "5m": 5 * MINUTE_MS, "1h": 60 * MINUTE_MS };

/**
 * How much of a task's prompt cache is still warm. A partial record's newer
 * 5m tail expires first, and its earlier 1h part stays warm after.
 */
export type PromptCacheLeft =
  | { state: "warm"; ms: number; ttl: "5m" | "1h"; earlierMs?: number }
  | { state: "partial"; ms: number }
  | { state: "expired" };

/** When the task's prompt cache fully expires, or nothing without a record. */
export function promptCacheEnd(task: Pick<TaskView, "provider_options">) {
  const record = promptCacheRecord(task);
  if (!record) return undefined;

  return record.start + TTL_MS[record.partial ? "1h" : record.ttl];
}

/** The task's prompt cache at `now`, or nothing when it has no record. */
export function promptCacheLeft(
  task: Pick<TaskView, "provider_options">,
  now: number,
): PromptCacheLeft | undefined {
  const record = promptCacheRecord(task);
  if (!record) return undefined;

  const ms = record.start + TTL_MS[record.ttl] - now;
  const earlierMs = record.partial ? record.start + TTL_MS["1h"] - now : 0;

  if (ms > 0) {
    return {
      state: "warm",
      ms,
      ttl: record.ttl,
      ...(earlierMs > 0 ? { earlierMs } : {}),
    };
  }

  return earlierMs > 0
    ? { state: "partial", ms: earlierMs }
    : { state: "expired" };
}

function promptCacheRecord(task: Pick<TaskView, "provider_options">) {
  const parsed = claudeTaskOptionsSchema.safeParse(
    optionsForProvider(task.provider_options, "claude"),
  );

  const record = parsed.success ? parsed.data.prompt_cache : undefined;

  return record && { ...record, start: Date.parse(record.requested_at) };
}
