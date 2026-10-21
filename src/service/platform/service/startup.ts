import { flushLogs, logEvent } from "../logging/logger.js";
import { handleExistingService } from "./existing-service.js";
import { ExistingServiceError } from "./lease.js";
import { PortInUseError } from "./port.js";
import { serve, type ServeOptions } from "./serve.js";
import { writeStartupOutput } from "./startup-output.js";

export async function startService(options: ServeOptions = {}) {
  try {
    await serve(options);
  } catch (error) {
    if (error instanceof PortInUseError) return reportPortInUse(error);
    if (!(error instanceof ExistingServiceError)) throw error;
    if (await handleExistingService(error)) await retryService(options);
  }
}

/** Explains a taken port without a stack trace, and fails the command. */
async function reportPortInUse(error: PortInUseError) {
  logEvent("error", "service.port_in_use", { port: error.port });
  await flushLogs();
  writeStartupOutput([{ type: "message", text: error.message }]);
  process.exitCode = 1;
}

async function retryService(options: ServeOptions) {
  // Separate the retried service banner from the process-conflict output above.
  process.stderr.write("\n");

  try {
    await serve(options);
  } catch (error) {
    if (error instanceof PortInUseError) return reportPortInUse(error);
    if (!(error instanceof ExistingServiceError)) throw error;

    writeStartupOutput([
      {
        type: "message",
        text: "Another live service now owns the data directory.",
      },
      {
        type: "fields",
        fields: [
          { label: "PID", value: String(error.pid) },
          { label: "Lock file", value: error.lockFile },
        ],
      },
    ]);

    process.exitCode = 1;
  }
}
