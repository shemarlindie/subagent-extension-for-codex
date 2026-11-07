import type { HookJSONOutput, Options } from "@anthropic-ai/claude-agent-sdk";

import type { ClaudePolicy } from "../../../../../shared/providers/claude/permissions.js";
import { readClaudeTaskOptions } from "../../../../../shared/providers/claude/task-options.js";
import type { Task } from "../../../../../shared/tasks/model.js";
import type { RunContext } from "../../types.js";
import {
  adminTokenRule,
  claudeAdminToken,
  touchesAdminToken,
} from "../configuration/admin-token.js";
import { claudeEnvironment } from "../configuration/execution-environment.js";
import { recordClaudeFileEdits } from "./file-edits.js";

/** The reason shown when a permission prompt is denied without a message. */
function defaultDenialMessage(tool: string) {
  if (tool === "Bash") return "Command denied";

  return ["Edit", "Write"].includes(tool) ? "Edit denied" : "Tool call denied";
}

/** Which Claude Code settings a session loads, and whether their MCP servers join the extension's. */
function settingsOptions(policy: ClaudePolicy): Partial<Options> {
  return {
    settingSources: policy.settings_files ? ["user", "project", "local"] : [],
    // Strict MCP config also ignores servers outside settings files, such as
    // `.mcp.json`, user-scope servers and plugins.
    ...(policy.settings_files && policy.user_mcp
      ? {}
      : { strictMcpConfig: true }),
  };
}

function workspaceRule(task: Task) {
  if (task.workspace_strategy !== "current_repo") {
    return "Never modify the primary checkout.";
  }

  return task.no_git || !task.base_commit
    ? "This is the user's project folder, with no Git history to undo edits. Preserve unrelated files. Write profiles edit it directly."
    : "This is the current repository. Preserve unrelated uncommitted changes. Write profiles edit the user checkout directly.";
}

/** The task's role and workspace rules, then the user's custom instructions. */
function systemPromptAppend(c: RunContext) {
  const role =
    c.task.worker_profile === "general"
      ? "coding agent"
      : c.task.worker_profile;

  const rules = [
    "Work only in the provided task workspace. End each turn with a plain reply that says what you did, what you found and what is left.",
    "Follow the configured native permission mode for tool execution.",
    workspaceRule(c.task),
  ];

  const environment = `You are a delegated worker running inside Subagent Extension for Codex. Codex is the parent agent, and the user communicates through its chat and the extension panel. Task ID: ${c.task.id}. Parent conversation: ${c.task.conversation_id ?? "unavailable"}. Workspace: ${c.task.workspace}. Your replies appear in the task conversation, where Codex reads them. Use AskUserQuestion for questions and the normal permission flow for approvals.`;

  const parts = [
    environment,
    `You are an independent ${role}. ${rules.join(" ")}`,
  ];

  if (c.task.profile_instructions) {
    parts.push(
      `The user's custom instructions for the ${c.task.worker_profile} profile:\n${c.task.profile_instructions}`,
    );
  }

  return parts.join("\n\n");
}

/**
 * The SDK options for one turn of a task: its workspace, session, model and
 * budget, and the task's settings. The admin token is denied twice: a
 * settings rule, which the sandbox applies to every program, and a PreToolUse
 * hook for file tools, since an org can drop the rule.
 */
export async function claudeTurnOptions(
  c: RunContext,
  executable: string,
  /** Stops the process: only when an interrupt doesn't end the turn. */
  abortController: AbortController,
): Promise<Options> {
  const taskOptions = readClaudeTaskOptions(c.task);
  const policy = taskOptions.claude_policy;
  const nativeMode = taskOptions.permission_mode;

  const workspace = c.task.workspace!;
  const adminToken = await claudeAdminToken();

  return {
    pathToClaudeCodeExecutable: executable,
    cwd: workspace,
    ...(c.task.model ? { model: c.task.model } : {}),
    ...(c.task.reasoning_effort && c.task.reasoning_effort !== "default"
      ? { effort: c.task.reasoning_effort as Options["effort"] }
      : {}),
    env: claudeEnvironment(process.env),
    // Settings and org policy decide the rest of the sandbox.
    ...(policy.sandbox
      ? { sandbox: { enabled: true, failIfUnavailable: true } }
      : {}),
    abortController,
    persistSession: true,
    resume: c.task.session_id,
    // Stream frames carry the reply as it's written, and show when the
    // final message ends, the last moment a steer the turn won't take can
    // be withdrawn.
    includePartialMessages: true,
    settings: {
      bashEditDiffEnabled: true,
      // Inside the sandbox, Claude Code applies it to every program.
      permissions: { deny: [adminTokenRule(adminToken)] },
    },
    ...settingsOptions(policy),
    permissionMode: nativeMode,
    ...(nativeMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    tools: { type: "preset", preset: "claude_code" },
    disallowedTools: policy.subagents ? [] : ["Agent", "Task"],
    ...(c.task.budget.max_cost_usd === null
      ? {}
      : {
          maxBudgetUsd: c.task.budget.max_cost_usd - (c.task.cost_usd ?? 0),
        }),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPromptAppend(c),
    },
    hooks: {
      PostToolUse: [
        {
          hooks: [
            async (input) => {
              if (input.hook_event_name === "PostToolUse") {
                recordClaudeFileEdits(
                  c,
                  input.tool_name,
                  input.tool_response,
                  c.task.no_git,
                );
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

              return (await touchesAdminToken(
                adminToken,
                input.tool_name,
                input.tool_input as Record<string, unknown>,
                workspace,
              ))
                ? {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "deny",
                      permissionDecisionReason: "The admin token is off limits",
                    },
                  }
                : {};
            },
          ],
        },
      ],
    },
    canUseTool: async (tool, input, { signal }) => {
      if (tool === "AskUserQuestion") {
        const answer = await c.input(tool, input, signal);

        return answer.approved
          ? { behavior: "allow", updatedInput: { ...input, ...answer.input } }
          : { behavior: "deny", message: answer.message ?? "User declined" };
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
