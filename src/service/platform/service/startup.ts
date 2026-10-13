import { handleExistingService } from "./existing-service.js";
import { ExistingServiceError } from "./lease.js";
import { serve, type ServeOptions } from "./serve.js";
import { writeStartupOutput } from "./startup-output.js";

export async function startService(options: ServeOptions = {}) {
  try {
    await serve(options);
  } catch (error) {
    if (!(error instanceof ExistingServiceError)) throw error;
    if (await handleExistingService(error)) await retryService(options);
  }
}

async function retryService(options: ServeOptions) {
  // Separate the retried service banner from the process-conflict output above.
  process.stderr.write("\n");

  try {
    await serve(options);
  } catch (error) {
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
