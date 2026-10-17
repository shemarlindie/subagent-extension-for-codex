import type { HookJSONOutput, Options } from "@anthropic-ai/claude-agent-sdk";

import { readOnlyProfile } from "../../../../../shared/providers/claude/permissions.js";
import { readClaudeTaskOptions } from "../../../../../shared/providers/claude/task-options.js";
import type { RunContext } from "../../types.js";
import {
  claudeEnvironment,
  claudeSandbox,
} from "../configuration/execution-environment.js";
import {
  approvalTool,
  inWorkspace,
  pathTools,
  readTools,
  toolPath,
  writeTools,
} from "../configuration/tool-policy.js";
import { recordClaudeFileEdits } from "./file-edits.js";
import { PARENT_TOOL, parentEnvironment, parentServer } from "./parent-tool.js";

/** The reason shown when a permission prompt is denied without a message. */
function defaultDenialMessage(tool: string) {
  if (tool === "Bash") return "Command denied";

  return writeTools.includes(tool) ? "Edit denied" : "Tool call denied";
}

/**
 * The SDK options for one turn of a task: its workspace, session, model and
 * budget, and the task's resolved permission policy. Restricted tools and
 * the path guard are enforced twice: a PreToolUse hook denies before settings
 * rules or modes can approve, and \`canUseTool\` checks again before asking the
 * task's approver.
 */
export async function claudeTurnOptions(
  c: RunContext,
  executable: string,
  /** Stops the process: only when an interrupt doesn't end the turn. */
  abortController: AbortController,
): Promise<Options> {
  const taskOptions = readClaudeTaskOptions(c.task);

  if (
    !taskOptions.claude_policy ||
    !taskOptions.permission_mode ||
    !taskOptions.approval_decider
  ) {
    throw new Error("Claude task is missing resolved native permission state");
  }

  const policy = taskOptions.claude_policy;
  const nativeMode = taskOptions.permission_mode;

  const workspace = c.task.workspace!;
  const restricted = policy.tools === "restricted";

  const readOnly =
    restricted &&
    (readOnlyProfile(c.task.worker_profile) || nativeMode === "plan");

  const guarded = (tool: string) =>
    policy.path_guard && pathTools.includes(tool);

  // Restricted workers retain parent reporting alongside permitted task tools.
  const restrictedDenial = (tool: string) => {
    if (
      !restricted ||
      tool === PARENT_TOOL ||
      tool === "AskUserQuestion" ||
      tool === "Skill" ||
      readTools.includes(tool)
    ) {
      return undefined;
    }

    if (readOnly) return "Read-only worker profile";

    return approvalTool(tool) || writeTools.includes(tool)
      ? undefined
      : "Tool not permitted";
  };

  const sandbox =
    policy.sandbox === "user_config"
      ? {}
      : {
          sandbox: await claudeSandbox(c.task),
          ...(policy.sandbox === "extension_locked"
            ? {
                // Policy-tier lock: settings files cannot add network domains.
                managedSettings: {
                  sandbox: { network: { allowManagedDomainsOnly: true } },
                },
              }
            : {}),
        };

  return {
    pathToClaudeCodeExecutable: executable,
    cwd: workspace,
    ...(c.task.model ? { model: c.task.model } : {}),
    ...(c.task.reasoning_effort && c.task.reasoning_effort !== "default"
      ? { effort: c.task.reasoning_effort as Options["effort"] }
      : {}),
    env: claudeEnvironment(process.env, policy.environment),
    ...sandbox,
    abortController,
    persistSession: true,
    resume: c.task.session_id,
    // Stream frames carry the reply as it's written, and show when the
    // final message ends, the last moment a steer the turn won't take can
    // be withdrawn.
    includePartialMessages: true,
    settings: { bashEditDiffEnabled: true },
    settingSources: ["user", "project", "local"],
    permissionMode: nativeMode,
    ...(nativeMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    tools: restricted
      ? [
          ...readTools,
          ...(readOnly ? [] : [...writeTools, "Bash"]),
          "AskUserQuestion",
          "Skill",
        ]
      : { type: "preset", preset: "claude_code" },
    mcpServers: { codex_parent: parentServer(c) },
    disallowedTools: policy.subagents ? [] : ["Agent", "Task"],
    ...(c.task.budget.max_cost_usd === null
      ? {}
      : {
          maxBudgetUsd: c.task.budget.max_cost_usd - (c.task.cost_usd ?? 0),
        }),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `${parentEnvironment(c)}\n\nYou are an independent ${c.task.worker_profile === "general" ? "coding agent" : c.task.worker_profile}. Work only in the provided task workspace. End each turn with a plain reply that says what you did, what you found and what is left. ${readOnly ? "Inspect only; you cannot edit files or run shell commands." : "Follow the configured native permission mode for tool execution."} ${c.task.workspace_strategy === "current_repo" ? "This is the current repository; preserve unrelated uncommitted changes. Write profiles edit the user checkout directly." : "Never modify the primary checkout."}`,
    },
    hooks: {
      PostToolUse: [
        {
          hooks: [
            async (input) => {
              if (input.hook_event_name === "PostToolUse") {
                recordClaudeFileEdits(c, input.tool_name, input.tool_response);
              }

              return {};
            },
          ],
        },
      ],
      PreToolUse: [
        {
          hooks: [
            async (input): Promise<HookJSONOutput> => {
              if (input.hook_event_name !== "PreToolUse") return {};
              const tool = input.tool_name;
              const params = input.tool_input as Record<string, unknown>;

              // Approve reporting before native modes such as dontAsk can deny it,
              // without a bare allowedTools entry that shadows canUseTool.
              if (tool === PARENT_TOOL) {
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "allow",
                  },
                };
              }

              const deny = (reason: string): HookJSONOutput => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: reason,
                },
              });

              // Enabled restrictions deny before settings rules or modes can approve.
              // Skills stay available; the tools they call are checked individually.
              const denial = restrictedDenial(tool);
              if (denial) return deny(denial);

              if (
                guarded(tool) &&
                !(await inWorkspace(workspace, toolPath(params, workspace)))
              ) {
                return deny("Path outside task workspace or Git metadata");
              }

              return {};
            },
          ],
        },
      ],
    },
    canUseTool: async (tool, input, { signal }) => {
      if (tool === PARENT_TOOL) {
        return { behavior: "allow", updatedInput: input };
      }

      if (tool === "AskUserQuestion") {
        const answer = await c.input(tool, input, signal);

        return answer.approved
          ? { behavior: "allow", updatedInput: { ...input, ...answer.input } }
          : { behavior: "deny", message: answer.message ?? "User declined" };
      }

      const denial = restrictedDenial(tool);
      if (denial) return { behavior: "deny", message: denial };

      if (guarded(tool)) {
        if (!(await inWorkspace(workspace, toolPath(input, workspace)))) {
          return { behavior: "deny", message: "Path outside task workspace" };
        }

        // Guarded reads stay inside the workspace, so they need no prompt.
        if (readTools.includes(tool)) {
          return { behavior: "allow", updatedInput: input };
        }
      }

      // Calls not already approved by settings or the permission mode ask the task's approver.
      const answer = await c.input(tool, input, signal);

      return answer.approved
        ? { behavior: "allow", updatedInput: input }
        : {
            behavior: "deny",
            message: answer.message ?? defaultDenialMessage(tool),
          };
    },
  };
}
