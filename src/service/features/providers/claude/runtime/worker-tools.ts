import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  applyPlanUpdate,
  planProgress,
  planResultLine,
} from "../../../../../shared/tasks/plan.js";
import { logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";
import { WORKER_SERVER } from "./worker-tool-names.js";

/** The system prompt paragraph about the worker tools. */
export const workerToolsPrompt =
  "Use update_plan to show your plan as a checklist in the user's panel when a request takes several steps. Send the whole list once, then advance as each step finishes. Skip it for quick answers.";

const text = (value: string, isError?: true) => ({
  content: [{ type: "text" as const, text: value }],
  ...(isError ? { isError } : {}),
});

/**
 * The worker-facing MCP server for one turn, keyed by its name. It's separate
 * from the one Codex uses. Handlers act on the turn's task, so tools need no
 * task argument. Each tool changes nothing in the workspace, which plan mode
 * reads from `readOnlyHint`.
 */
export function workerMcpServers(c: RunContext) {
  const server = createSdkMcpServer({
    name: WORKER_SERVER,
    // Loaded from the start, so the worker needn't search for it first.
    alwaysLoad: true,
    tools: [
      tool(
        "update_plan",
        "Show your step-by-step plan as a checklist in the user's panel. Send the whole list with items, then call with advance: true as each step finishes. Send items again when the plan changes.",
        {
          items: z
            .array(
              z.object({
                content: z.string(),
                status: z.enum(["pending", "in_progress", "completed"]),
              }),
            )
            .optional(),
          advance: z.boolean().optional(),
        },
        async (input) => {
          const update = applyPlanUpdate(c.task.plan?.steps, input);
          if (update.kind === "invalid") return text(update.error, true);
          if (update.kind === "unchanged") return text(update.message);
          c.planUpdated(update.steps, update.changed);
          const { done, total } = planProgress(update.steps);
          logEvent("debug", "provider.plan_updated", { steps: total, done });

          return text(planResultLine(update.steps));
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });

  return { [WORKER_SERVER]: server };
}
