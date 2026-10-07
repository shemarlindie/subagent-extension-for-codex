import type { Settings } from "../settings/settings.js";
import {
  approvalRank,
  type InputAuthority,
  type Start,
  type Task,
} from "../tasks/model.js";

export interface TaskPreparation {
  input: Start;
  defaults: ReturnType<Settings["values"]>;
  authority: InputAuthority;
}

/** Native permissions and sessions remain provider-owned; the control plane persists the resolved task. */
export interface ProviderTaskPolicy {
  prepareStart(
    context: TaskPreparation,
  ): Partial<
    Pick<
      Task,
      "provider_options" | "approval_mode" | "model" | "reasoning_effort"
    >
  >;
  /** Undefined asks the configured decision-maker; questions always bypass automatic decisions. */
  decideInput(task: Task, tool: string): boolean | undefined;
  parentMayApprove(task: Task): boolean;
  inputKind(tool: string): "question" | "permission";
  validateSession?(task: Task): Promise<void>;
}

/** Whole-execution approval policy for providers without native per-tool permission handling. */
export const executionTaskPolicy: ProviderTaskPolicy = {
  inputKind: (tool) => (tool === "AskUserQuestion" ? "question" : "permission"),
  prepareStart({ input, defaults, authority }) {
    if (Object.keys(input.provider_options?.[input.provider] ?? {}).length)
      throw new Error("Provider does not accept task options");

    const approval_mode = input.approval_mode ?? defaults.default_approval_mode;

    if (
      authority !== "user" &&
      approvalRank[approval_mode] > approvalRank[defaults.default_approval_mode]
    )
      throw new Error("Task approval mode exceeds the user-approved default");

    return { approval_mode };
  },
  decideInput(task, tool) {
    if (tool === "AskUserQuestion") return undefined;
    if (task.approval_mode === "auto_approve") return true;
    if (task.approval_mode === "deny") return false;

    return undefined;
  },
  parentMayApprove: (task) => task.approval_mode === "parent_agent",
};
