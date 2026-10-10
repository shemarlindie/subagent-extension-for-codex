import { z } from "zod";

import { reasoningLevels } from "./reasoning.js";

export const roles = [
  "researcher",
  "reviewer",
  "implementer",
  "debugger",
  "test_engineer",
  "refactorer",
  "security_reviewer",
] as const;

export { reasoningLevels } from "./reasoning.js";
export const modelNameSchema = z.string().trim().max(200);
export const reasoningSchema = z.enum(["default", ...reasoningLevels]);

export const approvalModes = [
  "ask_user",
  "parent_agent",
  "auto_approve",
  "deny",
] as const;

export type ApprovalMode = (typeof approvalModes)[number];
export const approvalModeSchema = z.enum(approvalModes);

export const providerOptionsSchema = z.record(
  z.string(),
  z.record(z.string(), z.unknown()),
);

export type ProviderOptions = z.infer<typeof providerOptionsSchema>;

export const approvalLabels: Record<ApprovalMode, string> = {
  ask_user: "Ask user",
  parent_agent: "Parent agent",
  auto_approve: "Auto-approve in sandbox",
  deny: "Deny execution requests",
};

export const approvalRank: Record<ApprovalMode, number> = {
  deny: 0,
  ask_user: 1,
  parent_agent: 2,
  auto_approve: 3,
};

export type InputAuthority = "user" | "parent";

export const startSchema = z.object({
  provider_options: providerOptionsSchema
    .optional()
    .describe(
      "Provider-owned options, isolated under the selected provider ID and validated by that provider.",
    ),
  approval_mode: approvalModeSchema
    .optional()
    .describe(
      "Whole-execution approval policy for providers that support it. Model calls cannot increase approval authority.",
    ),
  provider: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,39}$/)
    .default("claude")
    .describe(
      "Worker provider id from list_available_workers; only enabled providers can run.",
    ),
  worker_profile: z.enum(roles).default("reviewer"),
  model: modelNameSchema
    .optional()
    .describe(
      "Model ID or provider alias. Blank inherits configured defaults.",
    ),
  reasoning_effort: reasoningSchema
    .optional()
    .describe("Reasoning effort; default inherits configured defaults."),
  description: z
    .string()
    .min(1)
    .max(20000)
    .describe("The full task instructions and details for the worker."),
  repository: z
    .string()
    .min(1)
    .default("current")
    .describe(
      "Explicit absolute Git repository root approved by list_agent_projects. current is rejected by the packaged service because it does not identify the chat project.",
    ),
  revision: z.string().default("HEAD"),
  conversation_id: z.string().optional(),
  depends_on: z.array(z.string()).max(50).default([]),
  context: z.array(z.string().max(20000)).max(20).default([]),
  workspace_strategy: z
    .enum(["worktree", "current_repo"])
    .default("current_repo")
    .describe(
      "worktree creates an isolated checkout at revision; current_repo uses the approved repository directly, including uncommitted files, and requires revision HEAD. Write profiles edit that checkout directly.",
    ),
  budget: z
    .object({
      max_runtime_minutes: z
        .number()
        .positive()
        .nullable()
        .default(null)
        .describe(
          "Runtime budget in minutes. Null disables the limit; new tasks have no runtime limit by default.",
        ),
      max_cost_usd: z
        .number()
        .positive()
        .nullable()
        .default(null)
        .describe(
          "Provider-native cost budget in USD. New tasks have no cost limit by default. Claude stops after a response reaches the budget, so a response can exceed it and interrupted usage may be missing. Null disables the budget; unsupported providers reject numeric limits.",
        ),
      max_tokens: z.number().int().positive().optional(),
    })
    .default({ max_runtime_minutes: null, max_cost_usd: null }),
});

export type Start = z.infer<typeof startSchema>;

export const statuses = [
  "queued",
  "starting",
  "running",
  "waiting",
  "interrupted",
  "completed",
  "failed",
] as const;

export type Status = (typeof statuses)[number];

/** Who sent a message: the user through the panel, or the parent agent. */
export type Sender = InputAuthority;

/** How a message reaches the worker; on an idle task, each starts the next turn. */
export const deliveries = ["steer", "queue", "interrupt"] as const;
export type Delivery = (typeof deliveries)[number];

/**
 * A follow-up's budget change. Each limit can only go up: a higher amount,
 * or null for no limit.
 */
export const budgetRaiseSchema = z
  .object({
    max_runtime_minutes: startSchema.shape.budget
      .removeDefault()
      .shape.max_runtime_minutes.removeDefault()
      .optional(),
    max_cost_usd: startSchema.shape.budget
      .removeDefault()
      .shape.max_cost_usd.removeDefault()
      .optional(),
  })
  .strict();

export type BudgetRaise = z.infer<typeof budgetRaiseSchema>;

/** A message after the first, with the id it keeps from when it's sent. */
export interface TaskMessage {
  id: string;
  message: string;
  from: Sender;
}

/** A message waiting in the task's queue for a turn of its own. */
export interface QueuedMessage extends TaskMessage {
  delivery: Delivery;
  /**
   * Its `task.instruction` is already recorded: a steer the turn ended
   * without taking, moved to the queue.
   */
  recorded?: boolean;
}

export interface InputPresentation {
  description: string;
  approveLabel: string;
  formMessage?: string;
  formTitle?: string;
  formApproveLabel?: string;
}

export interface Task extends Start {
  title: string;
  id: string;
  owner: string;
  /** Who started the task, and so sent its first message. */
  created_by: Sender;
  status: Status;
  /** Limits raised after this turn stopped at a budget. */
  budget_raised_for_turn?: {
    turn: number;
    cost?: true;
    runtime?: true;
  };
  waiting_reason?: string;
  /** The dependency a task waiting for one waits on. */
  waiting_for?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  /** Start of the run in progress; `runtime_ms` only counts finished runs. */
  run_started_at?: string;
  /** When the latest turn ended. */
  completed_at?: string;
  workspace?: string;
  base_commit?: string;
  /** The worktree's branch, `<worktree_branch_prefix><task-id>`. */
  branch?: string;
  /** current_repo: snapshot tree of the checkout when the task started. */
  start_tree?: string;
  /** Snapshot tree of the workspace when the latest turn started. */
  turn_start_tree?: string;
  /** The commit the workspace's HEAD was on when the latest turn started. */
  turn_head?: string;
  /**
   * current_repo: snapshot tree of the checkout when the latest turn ended,
   * or when it began waiting for input, where its changes stop; absent while
   * the worker runs.
   */
  end_tree?: string;
  session_id?: string;
  session_owner?: string;
  session_state_ref?: string;
  /**
   * The session's cumulative cost the provider last reported, which a
   * resumed session's next report includes.
   */
  session_cost_usd?: number;
  error?: string;
  pending_input?: {
    id: string;
    tool: string;
    kind: "question" | "permission";
    presentation?: InputPresentation;
    input: Record<string, unknown>;
  };
  /** Messages delivered or about to be, in the order the worker gets them. */
  instructions: TaskMessage[];
  /**
   * How many of `instructions` the worker's session has received; a resumed
   * session gets only the rest.
   */
  instructions_sent: number;
  /**
   * Steers sent into the running turn that it hasn't taken yet. One the turn
   * ends without taking moves to the front of the queue.
   */
  pending_steers: TaskMessage[];
  /** Messages that each start a turn of their own, in order. */
  queue: QueuedMessage[];
  /** An interrupt or failure paused the queue; the next message sent resumes it. */
  queue_paused?: boolean;
  /** The number of turns started, the current one included. */
  turn: number;
  /** Sum of the finished turns' run times. */
  runtime_ms: number;
  cost_usd?: number;
}

export function pendingInputKind(input: { kind: "question" | "permission" }) {
  return input.kind;
}
