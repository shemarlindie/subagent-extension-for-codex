type Phase = "send_storage" | "repository_validation" | "interrupt_shutdown";

/** Logs phase durations with opaque task IDs, never prompts or repository paths. */
function record(phase: Phase, taskId: string, started: number) {
  console.debug("task.timing", {
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
