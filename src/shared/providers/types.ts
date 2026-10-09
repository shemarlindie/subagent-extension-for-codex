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
