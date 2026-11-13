import { settingAt } from "../../../../shared/settings/settings-schema";
import { scalarText } from "../../../../shared/text";
import type { NewTaskState } from "../../../app/state/types";
import type { Defaults } from "../../settings/types";
import {
  type DelegateFormState,
  delegateInitialValues,
} from "../delegate-initial-values";
import type { DelegateValues } from "../delegate-values";
import {
  type ProjectTargetState,
  taskProjects,
  workerChoice,
} from "../delegation";

/** The session-memory entry that keeps the composer's draft. */
export const NEW_TASK_SESSION_ID = "draft";

/** A draft's first line, which stands in for the title until the task starts. */
export function draftTitle(description = "") {
  return description.trim().split("\n")[0] ?? "";
}

/** Projects a composed task can target. */
export function newTaskProjects(state: ProjectTargetState) {
  return taskProjects(state).filter((project) => project.kind === "repository");
}

/**
 * The model and reasoning a profile starts with in the composer: its saved
 * settings, which the composer's chips edit. Blank inherits the provider's.
 */
export function profileValues(
  worker: string,
  defaults?: Defaults,
): Pick<DelegateValues, "model" | "reasoning_effort"> {
  const scope = `models.profiles.${workerChoice(worker).profile}`;

  const saved = (key: string) =>
    scalarText(settingAt(defaults, `${scope}.${key}`));

  return {
    model: saved("model"),
    reasoning_effort: saved("reasoning_effort") || "default",
  };
}

/**
 * The composer's starting values: the scoped project (or the only one), the
 * default worker profile with its saved settings and the same settings defaults as
 * the Advanced task dialog. Values that depend on pending reads stay blank
 * until they load.
 */
export function newTaskInitialValues(
  newTask: NewTaskState,
  state: DelegateFormState,
): DelegateValues {
  const projects = newTaskProjects(state);

  const repository =
    state.repository ??
    (projects.length === 1 ? projects[0]?.repository : undefined);

  const values = delegateInitialValues({
    dialog: {
      kind: "delegate-loading",
      ...newTask,
      ...(repository ? { repository } : {}),
    },
    scope: state,
    draft: {},
  });

  return newTask.statuses.settings === "ready" && values.worker
    ? { ...values, ...profileValues(values.worker, newTask.defaults) }
    : values;
}
