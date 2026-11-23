import {
  createSdkMcpServer,
  tool,
  type HookCallback,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  applyPlanUpdate,
  pinnedPlan,
  planProgress,
  planResultLine,
} from "../../../../../shared/tasks/plan.js";
import { MAX_VISUAL_CODE } from "../../../../../shared/tasks/visual.js";
import { logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";
import { WORKER_SERVER } from "./worker-tool-names.js";

/** The system prompt paragraph about the worker tools. */
export const workerToolsPrompt =
  "Use update_plan to show your plan as a checklist in the user's panel, where they follow your progress. For any request that edits files or runs more than one command, send the whole list in the same message as your first other tool call. Then advance in the same message as the call that starts each next step, and once more before your final reply. If you get ahead of the list, catch up with done and start. Send the whole list again when the plan changes.\n\nThe panel renders your replies as Markdown, and shows charts, diagrams and other visuals you pass to show_visual.";

/**
 * A SessionStart hook that hands an open plan back to the worker after a
 * compaction drops its update_plan calls. A plan lasts one turn, so a turn's
 * new or resumed session never needs it.
 */
export function planReminder(c: RunContext): HookCallback {
  return async (input) => {
    const plan = pinnedPlan(c.task.plan);

    if (
      input.hook_event_name !== "SessionStart" ||
      input.source !== "compact" ||
      !plan
    ) {
      return {};
    }

    const steps = plan.steps.map(
      (s, i) => `${i + 1}. [${s.status}] ${s.content}`,
    );

    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: [
          "Your plan for this task, as the user's panel shows it:",
          ...steps,
          "Keep it current with update_plan: advance as steps finish, use done and start if you're past the step in progress, or send a new list if the work changed.",
        ].join("\n"),
      },
    };
  };
}

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
        "Show your step-by-step plan as a checklist in the user's panel. Send it in the same message as your next tool call when there is one. Send items with the whole list, or advance: true to complete the step in progress and start the next. To catch up after getting ahead, send done with the 1-based numbers of finished steps and start with the number of the step you're on. Send items again when the plan changes.",
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
          done: z.array(z.number().int()).optional(),
          start: z.number().int().optional(),
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
      tool(
        "show_visual",
        `Show a visual in the user's panel, such as a chart, diagram, mockup or small interactive page. Pass self-contained SVG or HTML in code, at most ${MAX_VISUAL_CODE} characters. It renders in a sandboxed frame without network access, so only inline scripts, inline styles and data URL images work. A link the user clicks shows below the visual, for them to open in their browser. Use the CSS variables --text, --muted, --background, --surface, --border and --accent so it matches the panel's light and dark themes. Use it whenever a visual would show something better than text. To fix or update a visual you showed, pass its number in replaces.`,
        {
          title: z.string(),
          code: z.string(),
          replaces: z.number().int().optional(),
        },
        async ({ title, code, replaces }) => {
          let visual: number;

          try {
            visual = c.visualShown(title, code, replaces);
          } catch (error) {
            return text((error as Error).message, true);
          }

          logEvent("debug", "provider.visual_shown", {
            visual,
            chars: code.length,
            replaced: replaces !== undefined,
          });

          return text(
            replaces === undefined
              ? `Shown as visual ${visual}.`
              : `Visual ${visual} replaced.`,
          );
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });

  return { [WORKER_SERVER]: server };
}
