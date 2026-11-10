import { AttachmentError } from "../../../shared/attachments/attachment-error.js";
import { SendRejectedError } from "../../../shared/tasks/conversation/send-errors.js";
import {
  errorCategory,
  PolicyRejectedError,
} from "../logging/error-metadata.js";
import { logError, logEvent, withLogContext } from "../logging/logger.js";

const rejectionMessages = new Set([
  "Unknown tool",
  "Unknown user tool",
  "User tools require a user interface",
  "Task not found",
  "Repository outside allowed roots (register this repository or approve its parent)",
  "Task belongs to a different conversation",
  "Task belongs to a different repository",
]);

function rejected(error: unknown) {
  return (
    error instanceof SendRejectedError ||
    error instanceof PolicyRejectedError ||
    error instanceof AttachmentError ||
    (error instanceof Error &&
      (error.name === "ZodError" || rejectionMessages.has(error.message)))
  );
}

/** Both HTTP and MCP record one outcome, including validation failures, without arguments. */
export async function observeTool<T>(
  name: string,
  run: () => Promise<T> | T,
  readOnly = false,
): Promise<T> {
  return withLogContext({ tool: name }, async () => {
    const started = performance.now();

    try {
      const result = await run();

      logEvent(readOnly ? "debug" : "info", "tool.completed", {
        outcome: "success",
        duration_ms: performance.now() - started,
      });

      return result;
    } catch (error) {
      const fields = {
        outcome: "failed",
        duration_ms: performance.now() - started,
      };

      if (rejected(error)) {
        logEvent("warn", "tool.completed", {
          ...fields,
          outcome: "rejected",
          error_type: error instanceof Error ? error.name : "NonError",
          error_category: errorCategory(error),
        });
      } else {
        logError("tool.completed", error, fields);
      }

      throw error;
    }
  });
}
