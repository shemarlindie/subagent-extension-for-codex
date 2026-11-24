import {
  createSdkMcpServer,
  tool,
  type HookCallback,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  applyPlanUpdate,
  MAX_PLAN_STEPS,
  pinnedPlan,
  planProgress,
  planResultLine,
} from "../../../../../shared/tasks/plan.js";
import {
  MAX_VISUAL_CODE,
  VISUAL_SERIES_COUNT,
  visualTokens,
} from "../../../../../shared/tasks/visual.js";
import {
  MAX_ACTION_LABEL,
  MAX_ASK,
  MAX_RECAP,
} from "../../../../../shared/tasks/wrap-up.js";
import { logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";
import { visualGuide, visualKinds } from "./visual-guide.js";
import { WORKER_SERVER } from "./worker-tool-names.js";

/** The system prompt paragraph about the worker tools. */
export const workerToolsPrompt =
  "Use update_plan to show your plan as a checklist in the user's panel. The user follows your progress there while you work, so keeping it is part of the task. For any request that edits files or runs more than one command, send the whole plan with your very first tool call, even one that only reads a file. As each step finishes, advance in the same message as the call that starts the next. Don't restate the plan as a list in your reply.\n\nWhen the work is done, call wrap_up, then write your final reply in full. Its box under your reply tells the user where things stand and asks them anything the next move waits on.\n\nThe panel renders your replies as Markdown, and shows charts, diagrams and other visuals you pass to show_visual.";

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
        [
          "Keep the checklist the user's panel shows while you work. Send it in the same message as another tool call, never alone.",
          '- First call: items with the whole plan in order, the step you\'re starting in_progress and the rest pending. If you must look around first, make "Look at how X works" step one and send a refined list once you know.',
          "- Next step: advance: true with the call that starts it. wrap_up checks off the rest.",
          "- Out of order: done with the 1-based numbers of finished steps and start with the number of the step you're on, in one call, never several advances in a row.",
          "- Plan changed, including right after a message from the user or Codex: items again with the whole new list, so the panel never shows an abandoned plan.",
          "Keep exactly one step in progress while you work, and none once all are done.",
        ].join("\n"),
        {
          items: z
            .array(
              z.object({
                content: z
                  .string()
                  .describe(
                    "A short imperative phrase of about seven words, without a number.",
                  ),
                status: z.enum(["pending", "in_progress", "completed"]),
              }),
            )
            .describe(
              `The whole plan in order, at most ${MAX_PLAN_STEPS} steps.`,
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
        `Show a visual in the user's panel, such as a chart, diagram, mockup or small interactive page. Before your first visual, call visual_guide with the kinds you're drawing, and again for a new kind. Pass self-contained SVG or HTML in code, at most ${MAX_VISUAL_CODE} characters. It renders in a sandboxed frame without network access, so only inline scripts, inline styles and data URL images work. A link the user clicks shows below the visual, for them to open in their browser. Use the CSS variables ${visualTokens.join(", ")} and --series-1 to --series-${VISUAL_SERIES_COUNT} so it matches the panel's light and dark themes. Give an SVG visual a width and height in pixels equal to its viewBox, at most 720 wide, so its text draws at the size you set. It shrinks to fit a narrow panel. Wrap an HTML visual in one element with a max-width at its ideal width. Use it whenever a visual would show something better than text. To fix or update a visual you showed, pass its number in replaces.`,
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
      tool(
        "visual_guide",
        "Get the style rules for show_visual, plus a section for each kind of visual you're drawing.",
        { kinds: z.array(z.enum(visualKinds)) },
        async ({ kinds }) => {
          logEvent("debug", "provider.visual_guide_read", {
            kinds: kinds.join(","),
          });

          return text(visualGuide(kinds));
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "wrap_up",
        [
          "Fill the box the user's panel shows under your final reply: a recap of where things stand and, when the next move is the user's call, one question with buttons that answer it.",
          "Call it once the turn's work is done, in every turn where you kept a plan, changed files, ran commands or did multi-step work. Skip it for short answers and pure conversation. It checks off your plan, so no closing update_plan is needed. A message from the user or Codex after it means the work goes on, so call it again once that's done.",
          "Then write your final reply, the full answer. The recap never replaces it, and a reply written before the call is lost.",
          "When the work leaves a real next step, make it the ask, with a button to do it. Finish unfinished or unverified parts of this task now or name them in the recap, never offer them as a follow-up. Don't repeat an offer the user passed over unless what it acts on changed.",
        ].join("\n"),
        {
          recap: z
            .string()
            .describe(
              `What is now true or changed, then what isn't done or verified, in two or three short sentences of at most ${MAX_RECAP} characters. Addressed to the user, it stands on its own without pointing elsewhere in the conversation, and makes no recommendation.`,
            ),
          ask: z
            .string()
            .describe(
              `Only when the next move is the user's call, such as a choice or a go-ahead: that one decision in at most ${MAX_ASK} characters, with no reason, recommendation or list of the options. Codex reads every reply and the user sees the panel, so either may answer it.`,
            )
            .optional(),
          actions: z
            .array(
              z.union([
                z.object({
                  label: z
                    .string()
                    .describe(
                      `A reply button of at most ${MAX_ACTION_LABEL} characters: an answer back to you that the user or Codex could send, such as "Yes, fix it". A click sends it as the user's answer.`,
                    ),
                }),
                z.object({
                  action: z
                    .literal("archive")
                    .describe(
                      "A panel button that archives the task, for when nothing is left to do.",
                    ),
                }),
              ]),
            )
            .describe(
              "1 or 2 answers to the ask, your pick first. Another is there only when the user might realistically pick it instead.",
            )
            .optional(),
          blocked: z
            .boolean()
            .describe("True when your work can't go on until the user answers.")
            .optional(),
        },
        async ({ recap, ask, actions, blocked }) => {
          try {
            c.wrappedUp({
              recap,
              ...(ask === undefined ? {} : { ask }),
              ...(actions ? { actions } : {}),
              ...(blocked ? { blocked } : {}),
            });
          } catch (error) {
            return text((error as Error).message, true);
          }

          logEvent("debug", "provider.wrapped_up", {
            ask: ask !== undefined,
            blocked: blocked === true,
          });

          return text("Wrap-up shown. Write your final reply now, in full.");
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });

  return { [WORKER_SERVER]: server };
}
