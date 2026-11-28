import { optionsForProvider } from "../../../core/shared/providers/options.js";
import type { TaskView } from "../../../core/shared/tasks/model.js";
import { claudeTaskOptionsSchema } from "./task-options.js";

const MINUTE_MS = 60_000;
const TTL_MS = { "5m": 5 * MINUTE_MS, "1h": 60 * MINUTE_MS };

/** How much of a task's prompt cache is still warm. */
export type PromptCacheLeft =
  { state: "warm"; ms: number; ttl: "5m" | "1h" } | { state: "expired" };

/** When the task's prompt cache expires, or nothing without a record. */
export function promptCacheEnd(task: Pick<TaskView, "provider_options">) {
  return promptCacheRecord(task)?.end;
}

/** The task's prompt cache at `now`, or nothing when it has no record. */
export function promptCacheLeft(
  task: Pick<TaskView, "provider_options">,
  now: number,
): PromptCacheLeft | undefined {
  const record = promptCacheRecord(task);
  if (!record) return undefined;

  const ms = record.end - now;

  return ms > 0 ? { state: "warm", ms, ttl: record.ttl } : { state: "expired" };
}

function promptCacheRecord(task: Pick<TaskView, "provider_options">) {
  const parsed = claudeTaskOptionsSchema.safeParse(
    optionsForProvider(task.provider_options, "claude"),
  );

  const record = parsed.success ? parsed.data.prompt_cache : undefined;

  return (
    record && {
      ttl: record.ttl,
      end: Date.parse(record.requested_at) + TTL_MS[record.ttl],
    }
  );
}
