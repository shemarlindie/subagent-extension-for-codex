import { createHash } from "node:crypto";
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type {
  SessionDeletionResource,
  SessionDeletionStatus,
} from "../../../../../shared/providers/types.js";
import type { Task } from "../../../../../shared/tasks/model.js";
import { pathSymlinks } from "../../../../platform/filesystem/path-symlinks.js";

type SessionLocation = Pick<Task, "session_id" | "session_state_ref">;

export async function claudeSessionDeletionStatus(
  task: SessionLocation,
): Promise<SessionDeletionStatus> {
  try {
    return { available: true, ...(await sessionFiles(task)) };
  } catch (error) {
    return {
      available: false,
      message:
        error instanceof Error
          ? error.message
          : "The session location could not be verified.",
    };
  }
}

export async function deleteClaudeSession(
  task: SessionLocation,
  expectedVersion?: string,
) {
  const files = await sessionFiles(task);

  if (expectedVersion && expectedVersion !== files.version) {
    throw new Error(
      "Session files changed. Review the deletion details again.",
    );
  }

  // Delete only the recorded transcript and its companion folder. The SDK's
  // ID-based deletion can select the same ID in a different project.
  for (const { path, kind } of files.resources) {
    await rm(path, { force: true, recursive: kind === "directory" });

    if (await sessionEntry(path)) {
      throw new Error(`Claude session data remains after cleanup: ${path}`);
    }
  }
}

async function sessionFiles(task: SessionLocation) {
  const { id, root, project, symlinks } = await sessionProject(task);
  const resources: SessionDeletionResource[] = [];

  const identities: unknown[] = [
    root,
    await identity(root),
    project,
    await identity(project),
    symlinks,
  ];

  for (const [path, kind] of [
    [join(project, `${id}.jsonl`), "file"],
    [join(project, id), "directory"],
  ] as const) {
    const data = await sessionEntry(path);
    identities.push([path, data?.dev, data?.ino, data?.mode]);
    if (!data) continue;

    if (
      data.isSymbolicLink() ||
      (kind === "file" ? !data.isFile() : !data.isDirectory())
    ) {
      throw new Error(
        "The recorded Claude session files are linked or have an unexpected type.",
      );
    }

    if (kind === "directory") await verifySessionTree(path);
    resources.push({ path, kind, ...(symlinks.length ? { symlinks } : {}) });
  }

  return {
    resources,
    version: createHash("sha256")
      .update(JSON.stringify(identities))
      .digest("hex"),
  };
}

async function sessionProject(task: SessionLocation) {
  const id = task.session_id;

  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error("The recorded Claude session ID is invalid.");
  }

  const ref = task.session_state_ref;

  if (!ref || !isAbsolute(ref)) {
    throw new Error("The Claude session location was not recorded.");
  }

  const configuredRoot = resolve(
    (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize(
      "NFC",
    ),
    "projects",
  );

  let root = configuredRoot;

  try {
    root = await realpath(configuredRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const project = dirname(ref);

  if (basename(ref) !== `${id}.jsonl` || dirname(project) !== root) {
    throw new Error(
      "The recorded Claude session location does not match the current data folder.",
    );
  }

  const parent = await sessionEntry(project);

  if (parent && !parent.isDirectory()) {
    throw new Error("The Claude session project folder is linked or invalid.");
  }

  return { id, root, project, symlinks: await pathSymlinks(configuredRoot) };
}

async function verifySessionTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error("The Claude session files include a symbolic link.");
    }

    if (entry.isDirectory()) await verifySessionTree(join(path, entry.name));
  }
}

async function identity(path: string) {
  const data = await sessionEntry(path);

  return data ? [data.dev, data.ino, data.mode] : undefined;
}

async function sessionEntry(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
