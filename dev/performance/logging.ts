/** Run with `node --import tsx dev/performance/logging.ts`. No model calls. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TimingReporter } from "../../src/panel/features/tasks/controls/timing-reporter.js";
import { decodePanelToolResult } from "../../src/panel/transports/event-decoding.js";
import {
  configureTimingLog,
  flushTimingLog,
  recordTaskTiming,
} from "../../src/service/features/tasks/runtime/timing.js";
import { ActivityPages } from "../../src/service/features/tasks/storage/activity-pages.js";
import { Store } from "../../src/service/features/tasks/storage/store.js";
import { JsonlWriter } from "../../src/service/platform/logging/jsonl-writer.js";
import {
  configureLogging,
  flushLogs,
} from "../../src/service/platform/logging/logger.js";
import { decodeEventEnvelope } from "../../src/shared/events/decode.js";
import type { EventEnvelope } from "../../src/shared/events/event-contract.js";
import type { ActivityPage } from "../../src/shared/tasks/activity/activity-tail.js";
import { groupActivity } from "../../src/shared/tasks/activity/activity-timeline.js";
import type { Task } from "../../src/shared/tasks/model.js";
import { panelTimingBatchSchema } from "../../src/shared/tasks/panel-timing.js";
import recording from "../panel/recorded/dev-plugin.json" with { type: "json" };

const POLLS = 200;
const REPEATS = 7;
const selected = process.argv[2];

if (
  selected &&
  selected !== "recorded-dev-plugin" &&
  selected !== "synthetic-tally"
) {
  throw new Error("Choose recorded-dev-plugin or synthetic-tally");
}

const recorded = recording as unknown as {
  task: Task;
  events: EventEnvelope[];
};

const synthetic = Array.from({ length: 20_000 }, (_, index): EventEnvelope => ({
  id: index + 1,
  task_id: recorded.task.id,
  timestamp: recorded.task.created_at,
  type: index >= 19_800 ? "agent.message" : "tool.started",
  data:
    index >= 19_800
      ? { role: "assistant", text: "Fixture message" }
      : { name: "Read" },
}));

interface Measurement {
  service_cpu_ms: number;
  service_read_ms: number;
  panel_cpu_ms: number;
  panel_processing_ms: number;
  records: number;
  queue_peak_bytes: number;
}

function cpuSince(start: NodeJS.CpuUsage) {
  const cpu = process.cpuUsage(start);

  return (cpu.user + cpu.system) / 1000;
}

async function sample(
  events: EventEnvelope[],
  enabled: boolean,
): Promise<Measurement> {
  const directory = await mkdtemp(join(tmpdir(), "performance-logging-"));
  const store = new Store(":memory:");
  // Kept unbound so the wrapper can call it with each real writer instance.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalWrite = JsonlWriter.prototype.write;
  let records = 0;
  let queuePeak = 0;

  // Development-only inspection of the existing bounded writer, without exposing
  // its internals to production instrumentation or substituting fake delivery.
  JsonlWriter.prototype.write = function (record) {
    originalWrite.call(this, record);
    records++;

    queuePeak = Math.max(
      queuePeak,
      (this as unknown as { pendingBytes: number }).pendingBytes,
    );
  };

  configureLogging(join(directory, "service.jsonl"));
  configureTimingLog(join(directory, "timing.jsonl"));

  const reporter = new TimingReporter({
    closed: () => false,
    tool: async <T>(_name: string, args: Record<string, unknown>) => {
      const batch = panelTimingBatchSchema.parse(args);

      for (const entry of batch.records) {
        if ("phase" in entry) recordTaskTiming(entry);
      }

      return { recorded: batch.records.length } as T;
    },
  });

  if (!enabled) {
    store.reads.measure = (_operation, run) => run({ rows: 0, tally_rows: 0 });
  }

  try {
    const serviceCpu = process.cpuUsage();
    store.save(recorded.task);

    const finish = enabled
      ? store.beginEventStorage(recorded.task.id, 1)
      : undefined;

    store.transaction(() => {
      for (const event of events) {
        store.eventOpaque(recorded.task, event.type, event.data);
      }
    });

    finish?.("completed");
    const pages = new ActivityPages(store);
    const started = performance.now();
    let page: ActivityPage = { events: [] };

    for (let index = 0; index < POLLS; index++) {
      store.list(recorded.task.owner, {});
      store.chatEvents(recorded.task.id);
      page = pages.page(recorded.task.id, 0);
    }

    const serviceRead = performance.now() - started;
    store.reads.flush();
    await flushLogs();
    const serviceElapsedCpu = cpuSince(serviceCpu);
    const panelCpu = process.cpuUsage();
    const panelStarted = performance.now();

    for (let index = 0; index < POLLS; index++) {
      const decoded = enabled
        ? decodePanelToolResult<ActivityPage>(
            "app_get_activity",
            page,
            (...args) => reporter.observe(...args),
          )
        : { ...page, events: page.events.map(decodeEventEnvelope) };

      const groupStarted = performance.now();

      const groups = groupActivity(decoded.events).sort(
        (a, b) => a.events.at(-1)!.id - b.events.at(-1)!.id,
      );

      if (enabled) {
        reporter.observe(
          "activity_latest",
          "group",
          performance.now() - groupStarted,
          { rows: decoded.events.length, groups: groups.length },
        );
      }
    }

    const panelProcessing = performance.now() - panelStarted;
    // End the measured active window immediately. This avoids sleeping five
    // seconds per sample and preserves the real reporter batch and receiver.
    (reporter as unknown as { flush(): void }).flush();
    await Promise.resolve();
    await flushTimingLog();

    return {
      service_cpu_ms: serviceElapsedCpu,
      service_read_ms: serviceRead,
      panel_cpu_ms: cpuSince(panelCpu),
      panel_processing_ms: panelProcessing,
      records,
      queue_peak_bytes: queuePeak,
    };
  } finally {
    reporter.dispose();
    store.close();
    await Promise.all([flushLogs(), flushTimingLog()]);
    configureLogging(undefined);
    configureTimingLog(undefined);
    JsonlWriter.prototype.write = originalWrite;
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [name, events] of [
  ["recorded-dev-plugin", recorded.events],
  ["synthetic-tally", synthetic],
] as const) {
  if (selected && selected !== name) continue;
  // Warm both modes before collecting paired, alternating measurements.
  await sample(events, false);
  await sample(events, true);
  const baseline: Measurement[] = [];
  const measured: Measurement[] = [];

  for (let repeat = 0; repeat < REPEATS; repeat++) {
    for (const enabled of repeat % 2 ? [true, false] : [false, true]) {
      (enabled ? measured : baseline).push(await sample(events, enabled));
    }
  }

  console.log(
    JSON.stringify({
      workload: name,
      events: events.length,
      polls: POLLS,
      baseline,
      measured,
    }),
  );
}
