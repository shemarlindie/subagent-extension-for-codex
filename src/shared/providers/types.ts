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
  /** Choices ruled out, each with the reason to show. */
  blocked: {
    setting: "permission_mode" | "sandbox";
    value: string;
    reason: string;
  }[];
  /** The model allowlist, for checking typed model IDs. */
  available_models?: string[];
  available_models_match?: "prefix" | "exact";
  /** Other active policy, as plain-language rows for Settings. */
  notes: { label: string; detail: string }[];
}
