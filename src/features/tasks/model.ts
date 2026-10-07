import { z } from "zod";

import { reasoningLevels } from "./policy/reasoning.js";

export const roles = [
  "researcher",
  "reviewer",
  "implementer",
  "debugger",
  "test_engineer",
  "refactorer",
  "security_reviewer",
] as const;

export { reasoningLevels } from "./policy/reasoning.js";
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
  parent_task_id: z.string().optional(),
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
        .max(120)
        .nullable()
        .default(20)
        .describe(
          "Runtime budget in minutes. Explicit null disables the limit.",
        ),
      max_cost_usd: z
        .number()
        .positive()
        .max(100)
        .nullable()
        .default(5)
        .describe(
          "Provider-native cost budget in USD. Claude stops after a response reaches the budget, so a response can exceed it and interrupted usage may be missing. Explicit null disables the budget; unsupported providers reject numeric limits.",
        ),
      max_tokens: z.number().int().positive().optional(),
    })
    .default({ max_runtime_minutes: 20, max_cost_usd: 5 }),
});

export type Start = z.infer<typeof startSchema>;

export type Status =
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export interface Result {
  summary: string;
  findings: string[];
  evidence: string[];
  changes: string[];
  tests: string[];
  recommendations: string[];
}

export const resultSchema = {
  type: "object",
  properties: Object.fromEntries(
    [
      "summary",
      "findings",
      "evidence",
      "changes",
      "tests",
      "recommendations",
    ].map((k) => [
      k,
      k === "summary"
        ? { type: "string" }
        : { type: "array", items: { type: "string" } },
    ]),
  ),
  required: [
    "summary",
    "findings",
    "evidence",
    "changes",
    "tests",
    "recommendations",
  ],
  additionalProperties: false,
};

export interface InputPresentation {
  description: string;
  approveLabel: string;
  formMessage?: string;
  formTitle?: string;
  formApproveLabel?: string;
}

export interface Task extends Start {
  title: string;
  /** Persisted recovery requirement keeps disabled providers locked after a restart. */
  provider_recovery_required: boolean;
  id: string;
  owner: string;
  status: Status;
  waiting_reason?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  /** Start of the run in progress; `runtime_ms` only counts finished runs. */
  run_started_at?: string;
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
  result?: Result;
  error?: string;
  pending_input?: {
    id: string;
    tool: string;
    kind: "question" | "permission";
    presentation?: InputPresentation;
    input: Record<string, unknown>;
  };
  instructions: string[];
  attempt: number;
  runtime_ms: number;
  cost_usd?: number;
}

export function pendingInputKind(input: { kind: "question" | "permission" }) {
  return input.kind;
}
