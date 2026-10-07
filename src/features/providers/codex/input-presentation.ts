import type { InputPresentation } from "../../tasks/model.js";

export const codexExecutionPresentation: InputPresentation = {
  description:
    "Approval covers the entire execution turn, including shell commands.",
  approveLabel: "Approve this execution turn",
  formMessage:
    "Allow this Codex execution turn? Approval covers the entire turn, including shell commands; there are no separate command approval prompts. Review the workspace and execution policy below.",
  formTitle: "Codex execution permission",
  formApproveLabel: "Approve this execution turn",
};
