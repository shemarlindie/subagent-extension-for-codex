import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import { logEvent } from "./logger.js";

/** One bounded histogram per service, sampled once a minute. */
export function startRuntimeMetrics(activeTasks: () => number) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previous = performance.eventLoopUtilization();
  let previousCpu = process.cpuUsage();

  const timer = setInterval(() => {
    const utilization = performance.eventLoopUtilization(previous);
    previous = performance.eventLoopUtilization();
    const cpu = process.cpuUsage(previousCpu);
    previousCpu = process.cpuUsage();
    const memory = process.memoryUsage();

    logEvent("info", "service.resources", {
      active_tasks: activeTasks(),
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      external_bytes: memory.external,
      event_loop_utilization: utilization.utilization,
      event_loop_p99_ms: delay.percentile(99) / 1_000_000,
      event_loop_max_ms: delay.max / 1_000_000,
      cpu_user_ms: cpu.user / 1000,
      cpu_system_ms: cpu.system / 1000,
    });

    delay.reset();
  }, 60_000);

  timer.unref();

  return () => {
    clearInterval(timer);
    delay.disable();
  };
}
