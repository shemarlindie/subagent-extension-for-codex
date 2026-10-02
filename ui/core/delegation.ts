import type { Defaults, DialogState, Project, Snapshot } from "./types";
import { selectedTask } from "./selectors";
/** Resolve defaults without treating an automatically highlighted task as project intent. */
export function delegationDialog(
  state: Snapshot,
  projects: Project[],
  defaults: Defaults,
  explicitSelection: boolean,
  preferredWorker?: string,
): Extract<DialogState, { kind: "delegate" }> {
  const choices = projects.filter((project) => project.kind === "repository");
  if (
    !choices.length &&
    !(
      state.mode === "panel" &&
      projects.some((project) => project.kind === "parent")
    )
  )
    throw new Error(
      "Register a repository using the local projects CLI before delegating.",
    );
  if (!state.workers.some((worker) => worker.profiles.length))
    throw new Error(
      "No workers are available. Check service configuration in Codex.",
    );
  const task = explicitSelection ? selectedTask(state) : undefined;
  return {
    kind: "delegate",
    defaults,
    preferredWorker,
    scope: state.scopeVersion,
    repository:
      state.mode === "console"
        ? undefined
        : (state.repository ??
          task?.repository ??
          (choices.length === 1 ? choices[0].repository : undefined)),
    revision: state.repository ? state.revision : (task?.revision ?? "HEAD"),
  };
}
