import type { Project } from "./types";

/** The project list after a project's removal. */
export function withoutProject(projects: Project[], repository: string) {
  return projects.filter((project) => project.repository !== repository);
}

/** The project list after a project's rename. */
export function renamedProject(
  projects: Project[],
  repository: string,
  name: string,
) {
  return projects.map((project) =>
    project.repository === repository ? { ...project, name } : project,
  );
}
