import { projectApproved } from "../../features/projects/selectors";
import type { Project, Snapshot } from "./types";

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
