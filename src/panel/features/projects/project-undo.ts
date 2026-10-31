import type { Project, Snapshot } from "../../app/state/types";
import { quote, type UndoEntry } from "../../app/state/undo-history";

interface ProjectUndoContext {
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  patch(patch: Partial<Snapshot>): void;
}

/** The name the service gives a project nobody renamed: its folder's. */
const folderName = (repository: string) =>
  repository.split(/[\\/]/).findLast(Boolean) ?? repository;

const projectName = (project: Project) =>
  project.name ?? folderName(project.repository);

/** Reads the projects again, so every view shows the change. */
async function reload(context: ProjectUndoContext) {
  const projects = await context.tool<Project[]>("list_projects", {});
  context.patch({ projects, projectsLoaded: true });
}

/** Approves the project again, with the name it had. */
async function add(context: ProjectUndoContext, project: Project) {
  const { repository } = await context.tool<{ repository: string }>(
    "app_register_project",
    { repository: project.repository },
  );

  const name = projectName(project);

  if (name !== folderName(repository)) {
    await context.tool("app_rename_project", { repository, name });
  }

  await reload(context);
}

/** Removes the project's approval, keeping its tasks. */
async function remove(context: ProjectUndoContext, repository: string) {
  await context.tool("app_remove_project", {
    repository,
    delete_tasks: false,
  });

  await reload(context);
}

async function rename(
  context: ProjectUndoContext,
  repository: string,
  name: string,
) {
  await context.tool("app_rename_project", { repository, name });
  await reload(context);
}

/**
 * The undo for a project removal or rename, given the project as it was.
 * Removing its tasks can't be undone, and neither can removing a parent
 * folder grant, which only the service's configuration can add.
 */
function projectChange(
  context: ProjectUndoContext,
  before: Project | undefined,
  name: string | undefined,
  deleteTasks: boolean,
): UndoEntry | undefined {
  if (!before) return undefined;

  const { repository } = before,
    was = projectName(before);

  if (name === undefined) {
    if (deleteTasks || before.kind === "parent") return undefined;

    return {
      label: `Removed project ${quote(was)}`,
      // The project leaves the list, so the change shows a toast.
      toast: true,
      undo: () => add(context, before),
      redo: () => remove(context, repository),
    };
  }

  const now = name.trim();
  if (now === was) return undefined;

  return {
    label: `Renamed project ${quote(was)} to ${quote(now)}`,
    undo: () => rename(context, repository, was),
    redo: () => rename(context, repository, now),
  };
}

/** The undo for adding a project, which removes its approval again. */
function projectAddition(
  context: ProjectUndoContext,
  project: Project,
): UndoEntry {
  return {
    label: `Added project ${quote(projectName(project))}`,
    undo: () => remove(context, project.repository),
    redo: () => add(context, project),
  };
}

/** Undo steps for the user's project changes, through `context`. */
export const projectUndoSteps = (context: ProjectUndoContext) => ({
  change: (before: Project | undefined, name?: string, deleteTasks = false) =>
    projectChange(context, before, name, deleteTasks),
  addition: (project: Project) => projectAddition(context, project),
});
