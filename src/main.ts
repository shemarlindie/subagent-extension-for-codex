import { parseArgs } from "node:util";

import { recordCrash } from "./core/service/platform/logging/crash-log.js";
import { flushLogs, logError } from "./core/service/platform/logging/logger.js";
import { startService } from "./core/service/platform/service/startup.js";
import { registerProviders } from "./core/shared/providers/registry.js";
import { claudeRegistration } from "./providers/claude/service/registration.js";
import { claudeDefinition } from "./providers/claude/shared/definition.js";
import { fixtureDefinition } from "./providers/fixture/shared/definition.js";

registerProviders([claudeDefinition, fixtureDefinition]);

process.on("uncaughtExceptionMonitor", recordCrash);

const { values } = parseArgs({ options: { host: { type: "boolean" } } });

try {
  await startService({
    registrations: [claudeRegistration],
    network: values.host,
  });
} catch (error) {
  logError("service.start_failed", error);
  await flushLogs();
  throw error;
}
