import { selectedTask } from "../../shared/state/selectors";
import type {
  Defaults,
  DialogState,
  Project,
  Snapshot,
} from "../../shared/state/types";

/** Registered projects plus the chat's project when starting a task may add it. */
export function taskProjects(state: Snapshot, projects = state.projects) {
  const candidate = state.projectCandidateAuto
    ? state.projectCandidate
    : undefined;

  return candidate &&
    !projects.some((project) => project.repository === candidate)
    ? [
        ...projects,
        { repository: candidate, kind: "repository", pending: true },
      ]
    : projects;
}

/** Resolve defaults without treating an automatically highlighted task as project intent. */
export function delegationDialog(
  state: Snapshot,
  projects: Project[],
  defaults: Defaults,
  explicitSelection: boolean,
  preferredWorker?: string,
): Extract<DialogState, { kind: "delegate" }> {
  projects = taskProjects(state, projects);
  const choices = projects.filter((project) => project.kind === "repository");
  if (!choices.length && !projects.some((project) => project.kind === "parent"))
    throw new Error("Add a project before delegating.");
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
      state.repository ??
      task?.repository ??
      choices.find((project) => project.pending)?.repository ??
      (choices.length === 1 ? choices[0].repository : undefined),
    revision: state.repository ? state.revision : (task?.revision ?? "HEAD"),
  };
}
