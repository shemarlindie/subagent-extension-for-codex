import { access } from "node:fs/promises";

import {
  exceedsPermission,
  resolveClaudePermission,
  resolveClaudePolicy,
} from "../../../../../shared/providers/claude/permissions.js";
import {
  claudeStartOptionsSchema,
  readClaudeTaskOptions,
} from "../../../../../shared/providers/claude/task-options.js";
import {
  optionsForProvider,
  withProviderOptions,
} from "../../../../../shared/providers/options.js";
import type { ProviderTaskPolicy } from "../../task-policy.js";

type TaskPreparation = Parameters<ProviderTaskPolicy["prepareStart"]>[0];

/**
 * The Claude options a task stores, from the options it asks for under
 * `provider`. Only the user can raise its mode or parent approval beyond the
 * settings, or turn off a sandbox the settings turn on.
 */
export function claudeStartOptions(
  { input, defaults, authority }: TaskPreparation,
  provider: string,
) {
  const { sandbox, ...requested } = claudeStartOptionsSchema.parse(
    optionsForProvider(input.provider_options, provider),
  );

  const claude = defaults.providers.claude;

  const resolved = resolveClaudePermission(
    requested,
    claude.permission_mode,
    input.worker_profile,
  );

  if (authority !== "user") {
    if (exceedsPermission(resolved.mode, claude.permission_mode)) {
      throw new Error(
        "Task permission mode exceeds the user-approved native mode",
      );
    }

    if (
      requested.approval_decider === "parent_agent" &&
      defaults.approvals.decider !== "parent_agent"
    ) {
      throw new Error(
        "Parent approval requires user authorization in settings",
      );
    }

    if (sandbox === false && claude.sandbox) {
      throw new Error("Only the user can turn off the sandbox");
    }
  }

  return withProviderOptions(input.provider_options, provider, {
    ...requested,
    approval_decider: requested.approval_decider ?? defaults.approvals.decider,
    permission_mode: resolved.mode,
    permission_source: resolved.source,
    claude_policy: resolveClaudePolicy(claude, sandbox),
  });
}

const modelSettings =
  "A task runs every turn with the model settings it started with.";

// Clearing would leave the task's stored conversation out of step.
const conversation = "Start a new task for a fresh conversation.";

// Each turn launches Claude Code anew, so session state ends with the turn.
const acrossTurns = "Each turn starts a new Claude Code process.";

const userSettings = "It changes Claude Code settings outside the task.";
const outsideWork = "It starts work outside the task and its budget.";
const account = "It changes your Claude account.";

/**
 * Claude Code's own commands that tasks run. Its other commands are refused
 * until checked, since one may change settings outside the task or need the
 * terminal. Skills and plugin commands are the user's own and always run.
 */
const supportedCommands = new Set([
  "artifact-capabilities",
  "artifact-diagramming",
  "claude-api",
  "claude-approvals",
  "code-review",
  "compact",
  "context",
  "dataviz",
  "debug",
  "fewer-permission-prompts",
  "init",
  "insights",
  "list-agents",
  "recap",
  "run",
  "run-skill-generator",
  "security-review",
  "simplify",
  "skill-doctor",
  "team-onboarding",
  "usage",
  "verify",
]);

/** Why some of Claude Code's own commands are refused, where it helps. */
const refusalReasons = new Map([
  ["model", modelSettings],
  ["effort", modelSettings],
  ["fast", modelSettings],
  ["clear", conversation],
  ["rename", "Rename the task instead."],
  ["loop", acrossTurns],
  ["goal", acrossTurns],
  ["config", userSettings],
  ["autocompact", userSettings],
  ["output-style", userSettings],
  ["import", userSettings],
  ["auto-mode-setup", userSettings],
  ["update-config", userSettings],
  ["doctor", userSettings],
  ["ultrareview", outsideWork],
  ["batch", outsideWork],
  ["schedule", outsideWork],
  ["design-consent", account],
  ["design-revoke", account],
  ["extra-usage", account],
  ["usage-credits", account],
]);

export const claudeTaskPolicy = {
  inputKind: (tool) => (tool === "AskUserQuestion" ? "question" : "permission"),
  prepareStart(context) {
    const { input } = context;

    if (input.approval_mode !== undefined) {
      throw new Error(
        "Claude uses permission_mode and approval_decider; approval_mode is only supported by execution-approval providers",
      );
    }

    if (
      input.reasoning_effort &&
      ["none", "minimal"].includes(input.reasoning_effort)
    ) {
      throw new Error(
        "Claude reasoning must be low, medium, high, xhigh or max",
      );
    }

    return { provider_options: claudeStartOptions(context, "claude") };
  },
  // Claude's SDK applies the native mode before forwarding unresolved requests.
  decideInput: () => undefined,
  parentMayApprove: (task) =>
    readClaudeTaskOptions(task).approval_decider === "parent_agent",
  async validateSession(task) {
    if (task.session_state_ref) await access(task.session_state_ref);
  },
  commandRefusal: (name, builtin) =>
    refusalReasons.get(name) ??
    (builtin && !supportedCommands.has(name)
      ? "Tasks run only the Claude Code commands checked to work in them."
      : undefined),
} satisfies ProviderTaskPolicy;
