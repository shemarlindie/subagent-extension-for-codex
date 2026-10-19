import { parseArgs } from "node:util";

import { recordCrash } from "./platform/logging/crash-log.js";
import { flushLogs, logError } from "./platform/logging/logger.js";
import { startService } from "./platform/service/startup.js";

process.on("uncaughtExceptionMonitor", recordCrash);

const { values } = parseArgs({ options: { host: { type: "boolean" } } });

try {
  await startService({ network: values.host });
} catch (error) {
  logError("service.start_failed", error);
  await flushLogs();
  throw error;
}
