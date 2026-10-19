import { appendFile, rename, stat } from "node:fs/promises";

type Phase = "send_storage" | "repository_validation" | "interrupt_shutdown";

interface TimingLog {
  path: string;
  maxBytes: number;
  /** Bytes in the current file, read lazily on the first write. */
  size?: number;
  failureReported: boolean;
}

let log: TimingLog | undefined;
let writes = Promise.resolve();

/**
 * Sends `task.timing` records to a JSON Lines file. Records are dropped until
 * this is called. Once the file would pass `maxBytes`, it replaces `<path>.1`
 * and a new file starts, so the log stays bounded.
 */
export function configureTimingLog(
  path: string | undefined,
  maxBytes = 5_000_000,
) {
  log = path ? { path, maxBytes, failureReported: false } : undefined;
}

/** Appends one record with opaque task IDs, never prompts or repository paths. */
export function recordTaskTiming(fields: Record<string, unknown>) {
  if (!log) return;

  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    event: "task.timing",
    ...fields,
  })}\n`;

  const target = log;

  // Chains appends so records keep their order.
  writes = writes
    .then(() => append(target, line))
    .catch((error: unknown) => {
      if (target.failureReported) return;
      target.failureReported = true;
      console.error(`Could not write timing log ${target.path}`, error);
    });
}

async function append(target: TimingLog, line: string) {
  const bytes = Buffer.byteLength(line);

  target.size ??= await stat(target.path).then(
    (s) => s.size,
    () => 0,
  );

  if (target.size > 0 && target.size + bytes > target.maxBytes) {
    await rename(target.path, `${target.path}.1`);
    target.size = 0;
  }

  await appendFile(target.path, line, { mode: 0o600 });
  target.size += bytes;
}

/** Resolves once every record queued so far is written, so an exit doesn't drop them. */
export function flushTimingLog() {
  return writes;
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
