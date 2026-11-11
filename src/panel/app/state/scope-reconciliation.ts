import { projectApproved } from "../../features/projects/selectors";
import type { PanelData, Project, Snapshot, Task } from "./types";

/** Whether the open dialog belongs to an earlier panel scope, so its form can't submit. */
export const dialogStale = (state: Pick<Snapshot, "dialog" | "scopeVersion">) =>
  state.dialog?.scope !== state.scopeVersion;

/** Validates host scope fields and supplies the panel's default revision. */
export function parsePanelScope(scope: PanelData["panel_scope"]) {
  if (
    !scope ||
    !(
      typeof scope.conversation_id === "string" ||
      scope.conversation_id === null
    ) ||
    (scope.repository !== undefined && typeof scope.repository !== "string")
  ) {
    return undefined;
  }

  return {
    conversation: scope.conversation_id ?? undefined,
    repository: scope.repository,
    revision: scope.revision ?? "HEAD",
  };
}

/** Applies the same scope restriction to opening data and refreshed task lists. */
export function tasksInScope(
  tasks: Task[],
  { conversation, repository }: Pick<Snapshot, "conversation" | "repository">,
) {
  return tasks.filter(
    (task) =>
      (!conversation || task.conversation_id === conversation) &&
      (!repository || task.repository === repository),
  );
}

/**
 * How a fresh project list invalidates the panel scope: "repository" when the
 * panel's own project was removed, "scope" when an open removal or New Task
 * dialog lost its project, and undefined otherwise. Other panels or the CLI
 * can remove projects too.
 */
export function projectRemovalReset(
  state: Snapshot,
  projects: Project[],
  removed: Project[],
  draftRepository: unknown,
): "repository" | "scope" | undefined {
  const { dialog, scopeVersion } = state;

  const removedHere = (repository: string) =>
    removed.some((project) => project.repository === repository);

  if (
    !state.conversation &&
    state.repository &&
    removedHere(state.repository)
  ) {
    return "repository";
  }

  if (
    dialog?.kind === "remove-project" &&
    dialog.scope === scopeVersion &&
    !projects.some(
      (project) => project.repository === dialog.project.repository,
    )
  ) {
    return "scope";
  }

  if (dialog?.kind !== "delegate" || dialog.scope !== scopeVersion) {
    return undefined;
  }

  // The draft's project wins over the one the dialog opened with.
  const repository =
    typeof draftRepository === "string" ? draftRepository : dialog.repository;

  return repository &&
    projectApproved(removed, repository) &&
    !projectApproved(projects, repository)
    ? "scope"
    : undefined;
}
