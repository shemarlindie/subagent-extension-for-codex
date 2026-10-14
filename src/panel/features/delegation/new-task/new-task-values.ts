import type { NewTaskState, Snapshot } from "../../../app/state/types";
import { delegateInitialValues } from "../delegate-initial-values";
import type { DelegateValues } from "../delegate-values";
import { taskProjects } from "../delegation";

/** The session-memory entry that keeps the composer's draft. */
export const NEW_TASK_SESSION_ID = "draft";

/** The profile a composed task starts with unless the user picks another. */
const NEW_TASK_PROFILE = "general";

/** Projects a composed task can target. */
export function newTaskProjects(state: Snapshot) {
  return taskProjects(state).filter((project) => project.kind === "repository");
}

/**
 * The composer's starting values: the scoped project (or the only one),
 * the General profile and the same settings defaults as the Advanced task
 * dialog. Values that depend on pending reads stay blank until they load.
 */
export function newTaskInitialValues(
  newTask: NewTaskState,
  state: Snapshot,
): DelegateValues {
  const projects = newTaskProjects(state),
    provider =
      newTask.defaults?.default_provider || state.workers[0]?.provider || "",
    repository =
      state.repository ??
      (projects.length === 1 ? projects[0]?.repository : undefined);

  return delegateInitialValues({
    dialog: {
      kind: "delegate-loading",
      ...newTask,
      preferredWorker: provider ? `${provider}:${NEW_TASK_PROFILE}` : undefined,
      ...(repository ? { repository } : {}),
    },
    scope: state,
    draft: {},
  });
}
