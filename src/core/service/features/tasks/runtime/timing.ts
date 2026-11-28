import { createHash } from "node:crypto";

import { errorCategory } from "../../../platform/logging/error-metadata.js";
import { JsonlWriter } from "../../../platform/logging/jsonl-writer.js";
import { logCorrelation } from "../../../platform/logging/logger.js";

type Phase =
  | "repository_validation"
  | "interrupt_shutdown"
  | "workspace_preparation"
  | "session_selection"
  | "prompt_assembly"
  | "provider_run";

export type TimingOutcome = "success" | "error" | "timeout" | "aborted";

/** Curated scalar metadata only, as for service log records. */
export type TimingFields = Record<
  string,
  string | number | boolean | undefined
>;

let writer: JsonlWriter | undefined;
let previousWrites = Promise.resolve();

/** Keep the task timing format stable while sharing bounded writing and rotation. */
export function configureTimingLog(
  path: string | undefined,
  maxBytes = 5_000_000,
) {
  previousWrites = flushTimingLog();
  writer = path ? new JsonlWriter(path, { maxBytes, backups: 1 }) : undefined;
}

/**
 * Appends a record with the service log's instance ID and, inside an HTTP
 * request, its request ID. A field set to undefined leaves either out.
 */
export function recordTaskTiming(fields: TimingFields) {
  writer?.write({
    ...logCorrelation(),
    ...fields,
    timestamp: new Date().toISOString(),
    event: "task.timing",
  });
}

export function flushTimingLog(): Promise<void> {
  return Promise.all([previousWrites, writer?.flush()]).then(() => {});
}

/**
 * Correlates a send's records without storing its caller-chosen request ID.
 * Retries reuse the ID, so they share the reference.
 */
export function sendRef(requestId: string | undefined) {
  if (requestId === undefined) return undefined;

  return createHash("sha256").update(requestId).digest("hex").slice(0, 16);
}

/** Classifies how a measured operation ended, without changing its error. */
export function timingOutcome(
  error: unknown,
  signal?: AbortSignal,
): TimingOutcome {
  if (signal?.aborted) return "aborted";
  const category = errorCategory(error);
  if (category === "aborted" || category === "timeout") return category;
  // A bounded Git probe reports its timeout by wrapping the killed process.
  const cause = error instanceof Error ? error.cause : undefined;

  return cause instanceof Error && "killed" in cause && cause.killed === true
    ? "timeout"
    : "error";
}

/** Timing never changes the measured operation's result or error. */
function record(
  phase: Phase | "send_storage",
  started: number,
  fields: () => TimingFields,
) {
  const duration = performance.now() - started;

  try {
    recordTaskTiming({ phase, ...fields(), duration_ms: duration });
  } catch {
    // Dropped like any other unwritable timing record.
  }
}

export function measureTaskWrite<T>(fields: TimingFields, write: () => T): T {
  const started = performance.now();

  try {
    const result = write();
    record("send_storage", started, () => ({ ...fields, outcome: "success" }));

    return result;
  } catch (error) {
    record("send_storage", started, () => ({
      ...fields,
      outcome: timingOutcome(error),
    }));

    throw error;
  }
}

type WaitOptions<T> = {
  /** An aborted signal marks a failure as aborted. */
  signal?: AbortSignal;
  /** Fields that describe a successful result. */
  detail?: (result: T) => TimingFields;
  /** Fields read when the wait ends, whatever its outcome. */
  end?: () => TimingFields;
};

export async function measureTaskWait<T>(
  phase: Phase,
  fields: TimingFields,
  wait: () => Promise<T>,
  { signal, detail, end }: WaitOptions<T> = {},
): Promise<T> {
  const started = performance.now();

  try {
    const result = await wait();

    record(phase, started, () => ({
      ...fields,
      ...end?.(),
      ...detail?.(result),
      outcome: "success",
    }));

    return result;
  } catch (error) {
    record(phase, started, () => ({
      ...fields,
      ...end?.(),
      outcome: timingOutcome(error, signal),
    }));

    throw error;
  }
}
