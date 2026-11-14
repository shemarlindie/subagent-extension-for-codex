import { selectedTask } from "../../app/state/selectors";
import type {
  Defaults,
  DelegateDialog,
  Project,
  Snapshot,
} from "../../app/state/types";
import { projectApproved } from "../projects/selectors";

/** Says where a thread panel's new task goes. Hosts don't share the thread's name. */
export const THREAD_TASK_NOTE =
  "This task will be linked to this conversation.";

/** The snapshot fields that decide which projects a task can target. */
export const PROJECT_TARGET_FIELDS = [
  "projects",
  "projectCandidate",
  "projectCandidateAuto",
  "projectCandidateGit",
] as const;

export type ProjectTargetState = Pick<
  Snapshot,
  (typeof PROJECT_TARGET_FIELDS)[number]
>;

/** Registered projects plus the chat's project when starting a task may add it. */
export function taskProjects(
  state: ProjectTargetState,
  projects = state.projects,
) {
  const candidate = state.projectCandidateAuto
    ? state.projectCandidate
    : undefined;

  return candidate &&
    !projects.some((project) => project.repository === candidate)
    ? [
        ...projects,
        {
          repository: candidate,
          kind: "repository",
          git: state.projectCandidateGit,
          pending: true,
        },
      ]
    : projects;
}

/** A project's Git state, when the service could read it. */
export const projectGit = (state: ProjectTargetState, repository?: string) =>
  taskProjects(state).find((project) => project.repository === repository)?.git;

/** A worker choice's `provider:profile` value; a bare provider has no profile. */
export function workerChoice(value: string) {
  const separator = value.indexOf(":");

  return separator < 0
    ? { provider: value }
    : {
        provider: value.slice(0, separator),
        profile: value.slice(separator + 1),
      };
}

/** Resolve defaults without treating an automatically highlighted task as project intent. */
export function delegationDialog(
  state: Snapshot,
  projects: Project[],
  defaults: Defaults,
  explicitSelection: boolean,
  preferredWorker?: string,
): DelegateDialog {
  projects = taskProjects(state, projects);
  const choices = projects.filter((project) => project.kind === "repository");
  const task = explicitSelection ? selectedTask(state) : undefined;

  const taskRepository =
    task && projectApproved(projects, task.repository)
      ? task.repository
      : undefined;

  const scopedRepository =
    state.repository && projectApproved(projects, state.repository)
      ? state.repository
      : undefined;

  const taskRevision = taskRepository ? (task?.revision ?? "HEAD") : "HEAD";

  return {
    kind: "delegate",
    defaults,
    preferredWorker,
    scope: state.scopeVersion,
    repository:
      scopedRepository ??
      taskRepository ??
      choices.find((project) => project.pending)?.repository ??
      (choices.length === 1 ? choices[0]?.repository : undefined),
    revision: scopedRepository ? state.revision : taskRevision,
  };
}
