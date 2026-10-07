import type { InputPresentation, Result, Task } from "../tasks/model.js";
import { reasoningLevels } from "../tasks/policy/reasoning.js";
import type { ProviderMetadata } from "./metadata.js";
import type { ProviderTaskPolicy } from "./task-policy.js";

export type { ActivityPresentation } from "./activity/types.js";

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

export interface RunContext {
  task: Task;
  signal: AbortSignal;
  emit: (type: string, data: Record<string, unknown>) => void;
  session: (id: string, stateRef: string) => void;
  input: (
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    presentation?: InputPresentation,
  ) => Promise<{
    approved: boolean;
    input?: Record<string, unknown>;
    message?: string;
  }>;
}

export interface ModelChoice {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: (typeof reasoningLevels)[number][];
}

export interface Provider {
  id: string;
  capabilities: Capabilities;
  metadata?: ProviderMetadata;
  taskPolicy: ProviderTaskPolicy;
  models?(): Promise<ModelChoice[]>;
  run(context: RunContext, prompt: string): Promise<Result>;
  /** Deletes the provider-side session a task ran in; one already gone is not an error. */
  deleteSession?(task: Task): Promise<void>;
  close?(): Promise<void>;
}
