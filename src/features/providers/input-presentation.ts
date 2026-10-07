import type { InputPresentation, Task } from "../tasks/model.js";

const defaultPresentation: InputPresentation = {
  description: "Review the full request before allowing the worker to proceed.",
  approveLabel: "Approve this request once",
};

/** Providers supply native disclosures; otherwise use the generic request presentation. */
export function inputPresentation(
  request: NonNullable<Task["pending_input"]>,
): InputPresentation {
  return request.presentation ?? defaultPresentation;
}
