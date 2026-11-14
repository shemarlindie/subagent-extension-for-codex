import { createHash } from "node:crypto";

import type { SessionDeletionStatus } from "../../../../shared/providers/types.js";
import type {
  TaskDeletionPreview,
  TaskDeletionTarget,
} from "../../../../shared/tasks/deletion-contract.js";
import type { Task } from "../../../../shared/tasks/model.js";
import { pathSymlinks } from "../../../platform/filesystem/path-symlinks.js";
import type { Control } from "./control.js";

type DeletionContext = Pick<
  Control,
  "store" | "workspaces" | "providers" | "ownerWorker"
>;

export type DeletionVersions = { workspace: string; session?: string };

export function projectDeletionTasks(
  c: DeletionContext,
  owner: string,
  repository: string,
) {
  const tasks = c.store.all().filter((task) => task.repository === repository);

  if (tasks.some((task) => task.owner !== owner)) {
    throw new Error(
      "This project has task data owned by another user. Remove those tasks first.",
    );
  }

  return tasks;
}

export async function taskDeletionPreview(
  c: DeletionContext,
  owner: string,
  ids: string[],
  includeSession: boolean,
  project?: string,
) {
  const selected = project
    ? projectDeletionTasks(c, owner, project).map((task) => task.id)
    : ids;

  return (
    await prepareTaskDeletion(c, owner, selected, includeSession, project)
  ).preview;
}

/** Checks a task that has a recorded provider session. */
async function taskSessionDeletion(
  c: DeletionContext,
  task: Task,
): Promise<SessionDeletionStatus> {
  if (task.session_owner !== c.ownerWorker) {
    return {
      available: false,
      message: "The session's original host cannot be verified here.",
    };
  }

  const provider = c.providers.get(task.provider);

  if (!provider?.deleteSession || !provider.sessionDeletionStatus) {
    return {
      available: false,
      message: "Provider session deletion is unavailable.",
    };
  }

  const status = await provider.sessionDeletionStatus(task);

  if (status.available && (!status.resources || !status.version)) {
    return {
      available: false,
      message: "The provider did not identify the session files to remove.",
    };
  }

  return status;
}

function sessionTarget(
  task: Task,
  session: SessionDeletionStatus | undefined,
  includeSession: boolean,
): Pick<TaskDeletionTarget, "session" | "sessionRecorded"> {
  if (!session) return { sessionRecorded: false };

  // An available session always has an id and resources.
  if (
    !includeSession ||
    !session.available ||
    !task.session_id ||
    !session.resources
  ) {
    return {};
  }

  return {
    session: {
      provider: task.provider,
      id: task.session_id,
      resources: session.resources,
    },
  };
}

async function prepareTaskDeletion(
  c: DeletionContext,
  owner: string,
  ids: string[],
  includeSession: boolean,
  project?: string,
) {
  const targets: TaskDeletionTarget[] = [];
  const versions = new Map<string, DeletionVersions>();
  let sessions: SessionDeletionStatus | undefined;

  for (const id of [...new Set(ids)].sort()) {
    const task = c.store.get(id, owner);
    const workspace = await c.workspaces.deletion(task);
    const repositorySymlinks = await pathSymlinks(task.repository);

    // A task without a recorded session has nothing to remove or verify.
    const session = task.session_id
      ? await taskSessionDeletion(c, task)
      : undefined;

    if (session && !session.available && sessions?.available !== false) {
      sessions = {
        available: false,
        message: `${session.message ?? "Session files cannot be verified."} Task: ${task.title}`,
      };
    } else if (session) {
      sessions ??= { available: true };
    }

    targets.push({
      id: task.id,
      title: task.title,
      repository: task.repository,
      ...(repositorySymlinks.length ? { repositorySymlinks } : {}),
      worktree: workspace.worktree,
      worktreeSymlinks: workspace.worktreeSymlinks,
      branch: workspace.branch,
      ...(workspace.retained ? { retainedWorktree: workspace.retained } : {}),
      ...sessionTarget(task, session, includeSession),
    });

    versions.set(id, {
      workspace: workspace.version,
      ...(includeSession && session ? { session: session.version } : {}),
    });
  }

  sessions ??= {
    available: false,
    message:
      targets.length === 1
        ? "This task has no recorded provider session."
        : "No selected task has a recorded provider session.",
  };

  const confirmation =
    !includeSession || sessions.available
      ? createHash("sha256")
          .update(
            JSON.stringify([
              owner,
              project,
              includeSession,
              targets,
              [...versions],
            ]),
          )
          .digest("hex")
      : undefined;

  const preview: TaskDeletionPreview = {
    tasks: targets,
    ...(project ? { project } : {}),
    includeSession,
    sessionDeletion: sessions,
    confirmation,
  };

  return { preview, versions };
}

export async function confirmedTaskDeletion(
  c: DeletionContext,
  owner: string,
  ids: string[],
  includeSession: boolean,
  confirmation: string,
  project?: string,
) {
  const selected = project
    ? projectDeletionTasks(c, owner, project).map((task) => task.id)
    : ids;

  const prepared = await prepareTaskDeletion(
    c,
    owner,
    selected,
    includeSession,
    project,
  );

  if (prepared.preview.confirmation !== confirmation) {
    throw new Error(
      "Deletion details changed. Review them again before deleting.",
    );
  }

  return prepared;
}
