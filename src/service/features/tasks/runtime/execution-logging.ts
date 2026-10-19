import type { Task } from "../../../../shared/tasks/model.js";
import {
  logError,
  logEvent,
  withLogContext,
} from "../../../platform/logging/logger.js";

export async function observeExecution(task: Task, run: () => Promise<void>) {
  return withLogContext(
    {
      task_id: task.id,
      provider: task.provider,
      workspace_strategy: task.workspace_strategy,
    },
    async () => {
      const started = performance.now();
      const costBefore = task.cost_usd ?? 0;
      logEvent("info", "task.execution_started", { turn: task.turn });

      try {
        await run();
      } catch (error) {
        logError("task.finalization_failed", error, { turn: task.turn });
        throw error;
      } finally {
        logEvent("info", "task.execution_completed", {
          turn: task.turn,
          status: task.status,
          duration_ms: performance.now() - started,
          cost_usd: (task.cost_usd ?? 0) - costBefore,
        });
      }
    },
    { inherit: false },
  );
}
