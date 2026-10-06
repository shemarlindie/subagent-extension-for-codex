import { z } from "zod";

import {
  approvalDeciderSchema,
  type ClaudePolicy,
  permissionModeSchema,
} from "./policy/permissions.js";
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
  permission_mode: permissionModeSchema
    .optional()
    .describe(
      "Claude native SDK permission mode; inherit uses the user's Claude Code settings, or plan for read-only profiles. User settings can override.",
    ),
  approval_decider: approvalDeciderSchema
    .optional()
    .describe(
      "Who answers unresolved permission requests: user or parent_agent. This is independent of the native permission mode.",
    ),
  approval_mode: approvalModeSchema
    .optional()
    .describe(
      "Legacy approval policy. For Claude, use permission_mode and approval_decider; explicit legacy values map to native settings. Model calls cannot increase approval authority.",
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
  title: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Optional short title; generated from the full description when omitted.",
    ),
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

export interface Task extends Start {
  title: string;
  // "parent" appears only on tasks stored before parent-mode inheritance was removed.
  permission_source?:
    "task" | "setting" | "task_profile" | "user_config" | "parent";
  /** Claude session restrictions resolved from settings when the task starts. */
  claude_policy?: ClaudePolicy;
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
  /**
   * current_repo: snapshot tree of the checkout when the latest turn ended,
   * where its changes stop; absent while a turn runs.
   */
  end_tree?: string;
  session_id?: string;
  native_turn_id?: string;
  session_owner?: string;
  session_state_ref?: string;
  result?: Result;
  error?: string;
  pending_input?: { id: string; tool: string; input: Record<string, unknown> };
  instructions: string[];
  attempt: number;
  runtime_ms: number;
  cost_usd?: number;
}
