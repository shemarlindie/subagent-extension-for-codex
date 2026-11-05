import type { GitState } from "../../../shared/tasks/model.js";
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

/** Whether a project's tasks must run in place, because worktrees need a commit. */
export const runsInPlace = (git?: GitState) =>
  git === "none" || git === "no_commits";

/** The short tag for a project without a commit. */
export function gitTag(git?: GitState) {
  if (git === "none") return "No Git";

  return git === "no_commits" ? "No commits" : undefined;
}

/** A POSIX command to copy, so it can't set up whichever folder is current. */
export const gitInitCommand = (folder: string) =>
  `git init '${folder.replaceAll("'", `'\\''`)}'`;

/** A project's path for a menu, with its tag when it has one. */
export function projectPathLabel(project: Project) {
  const tag = gitTag(project.git);

  return tag ? `${project.repository} · ${tag}` : project.repository;
}
