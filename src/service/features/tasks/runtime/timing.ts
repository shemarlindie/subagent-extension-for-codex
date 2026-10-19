import { JsonlWriter } from "../../../platform/logging/jsonl-writer.js";

type Phase = "send_storage" | "repository_validation" | "interrupt_shutdown";

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

export function recordTaskTiming(fields: Record<string, unknown>) {
  writer?.write({
    ...fields,
    timestamp: new Date().toISOString(),
    event: "task.timing",
  });
}

export function flushTimingLog(): Promise<void> {
  return Promise.all([previousWrites, writer?.flush()]).then(() => {});
}

function record(phase: Phase, taskId: string, started: number) {
  recordTaskTiming({
    phase,
    task_id: taskId,
    duration_ms: performance.now() - started,
  });
}

export function measureTaskWrite<T>(taskId: string, write: () => T): T {
  const started = performance.now();

  try {
    return write();
  } finally {
    record("send_storage", taskId, started);
  }
}

export async function measureTaskWait<T>(
  phase: Exclude<Phase, "send_storage">,
  taskId: string,
  wait: () => Promise<T>,
): Promise<T> {
  const started = performance.now();

  try {
    return await wait();
  } finally {
    record(phase, taskId, started);
  }
}
