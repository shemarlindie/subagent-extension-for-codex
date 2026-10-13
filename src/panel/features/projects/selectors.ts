import type { Snapshot } from "../../app/state/types.js";
import type { Project } from "./types.js";

export function projectDisplayName(
  project: Pick<Project, "name" | "repository">,
) {
  const pathName = project.repository.split(/[\\/]/).filter(Boolean).at(-1);

  return project.name || pathName || project.repository;
}

export function matchesProjectQuery(
  project: Pick<Project, "name" | "repository">,
  query: string,
) {
  const text = query.trim().toLowerCase();

  return [project.repository, projectDisplayName(project)].some((part) =>
    part.toLowerCase().includes(text),
  );
}

/** Presentation of canonical registry paths; the service still validates access. */
export function projectApproved(projects: Project[], repository: string) {
  return projects.some(
    (project) =>
      project.repository === repository ||
      (project.kind === "parent" &&
        repository.startsWith(`${project.repository.replace(/\/$/, "")}/`)),
  );
}

export function projectChoices(state: Snapshot) {
  const choices = state.projects.filter(
    (project) => project.kind === "repository",
  );

  return state.repository &&
    !choices.some((project) => project.repository === state.repository)
    ? [{ repository: state.repository, kind: "repository" }, ...choices]
    : choices;
}
