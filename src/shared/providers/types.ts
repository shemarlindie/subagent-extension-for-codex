import { reasoningLevels } from "../tasks/reasoning.js";

export interface Capabilities {
  interrupt: boolean;
  session_continue: boolean;
  session_state_portable: boolean;
  interactive_input: boolean;
  worktree: boolean;
  cost_budget: boolean;
  runtime_budget: boolean;
  token_budget: boolean;
  subagents: boolean;
  parallel_subagents: boolean;
  dynamic_subagents: boolean;
}

export interface ModelChoice {
  value: string;
  /** The full model ID an alias stands for. */
  resolvedModel?: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: (typeof reasoningLevels)[number][];
}

/** Whether a provider can start work. */
export interface ProviderReadiness {
  ready: boolean;
  /** What is wrong and how to fix it, when not ready. */
  message?: string;
  /** Facts for diagnostics, such as the executable path and version. */
  details: Record<string, string>;
}

export type {
  SessionDeletionResource,
  SessionDeletionStatus,
} from "./session-deletion-contract.js";

/**
 * What policy limits for new tasks, in terms the panel can show. Absent means
 * nothing known, never that the organization allows everything, so tasks are
 * still checked as they run.
 */
export interface ProviderPolicy {
  /** Whether an organization's policy applies, as opposed to local settings. */
  managed: boolean;
  /** Where the organization's policy comes from, when that can be told. */
  source?: "console" | "device";
  /** Permission modes ruled out, each with the reason to show. */
  blocked: { value: string; reason: string }[];
  /** The model allowlist, for checking typed model IDs. */
  available_models?: string[];
  available_models_match?: "prefix" | "exact";
  /** The name of the model new tasks run by default, when policy sets it. */
  default_model?: string;
  /** The reasoning new tasks run by default, when policy sets it. */
  default_effort?: string;
  /** The highest reasoning policy allows, unless a model has its own. */
  max_effort?: string;
  /** Each model's own highest reasoning, by model name, in place of `max_effort`. */
  model_max_effort?: Record<string, string>;
  /** Approval prompts are denied without asking anyone. */
  prompts_denied?: boolean;
  /** Other active policy, as plain-language rows for Settings. */
  notes: { label: string; detail: string }[];
}
