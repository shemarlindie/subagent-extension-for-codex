import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { Task } from "../../../shared/tasks/model.js";
import { pathSymlinks } from "../../platform/filesystem/path-symlinks.js";
import { git, gitRepositoryRoot } from "./git.js";

/** Verifies the task still owns the worktree and branch selected for removal. */
export async function workspaceDeletion(task: Task, managedRoot: string) {
  if (
    task.workspace_strategy !== "worktree" ||
    (!task.workspace && !task.branch)
  ) {
    return { version: "none" };
  }

  const root = resolve(managedRoot);

  if (
    !task.workspace ||
    !task.branch ||
    dirname(resolve(task.workspace)) !== root
  ) {
    const retained = retainedWorktree(task);

    return { retained, version: JSON.stringify(retained) };
  }

  const expectedPath = resolve(task.workspace);

  const entry = await worktreeEntry(task.workspace);
  const repository = await realpath(task.repository);
  const repositoryIdentity = await lstat(repository);
  const repositoryCommon = await commonDirectory(repository);
  const commonIdentity = await lstat(repositoryCommon);
  let worktree: string | undefined;

  if (entry) {
    if (!entry.isDirectory() || task.workspace_removed) {
      throw new Error(
        "The task's worktree was replaced or linked. It cannot be deleted safely.",
      );
    }

    const actual = await realpath(task.workspace);

    if (
      actual !== join(await realpath(root), basename(expectedPath)) ||
      (await gitRepositoryRoot(actual)) !== actual
    ) {
      throw new Error("The task's worktree location changed.");
    }

    const [branch, common] = await Promise.all([
      git(actual, ["symbolic-ref", "--quiet", "HEAD"]),
      commonDirectory(actual),
    ]);

    if (
      branch.trim() !== `refs/heads/${task.branch}` ||
      common !== repositoryCommon
    ) {
      throw new Error(
        "The worktree now belongs to a different branch or repository.",
      );
    }

    worktree = actual;
  }

  const tip = await branchTip(task.repository, task.branch);
  const worktreeSymlinks = await pathSymlinks(task.workspace);

  if (tip && task.branch_deleted) {
    throw new Error(
      "The task's deleted branch was recreated. It will be kept.",
    );
  }

  return {
    worktree,
    worktreeSymlinks,
    branch: tip ? task.branch : undefined,
    branchTip: tip,
    version: createHash("sha256")
      .update(
        JSON.stringify([
          repository,
          repositoryIdentity.dev,
          repositoryIdentity.ino,
          repositoryCommon,
          commonIdentity.dev,
          commonIdentity.ino,
          expectedPath,
          entry?.dev,
          entry?.ino,
          task.branch,
          tip,
          worktreeSymlinks,
        ]),
      )
      .digest("hex"),
  };
}

/** Outside the managed folder, the worktree and its branch stay with the user. */
function retainedWorktree(task: Task) {
  return {
    ...(!task.workspace_removed ? { worktree: task.workspace } : {}),
    ...(!task.branch_deleted ? { branch: task.branch } : {}),
  };
}

export async function branchTip(repository: string, branch: string) {
  return git(repository, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]).then(
    (value) => value.trim(),
    (error: unknown) => {
      if ((error as { code?: unknown }).code === 1) return undefined;
      throw error;
    },
  );
}

async function commonDirectory(path: string) {
  const common = (await git(path, ["rev-parse", "--git-common-dir"])).trim();

  return realpath(resolve(path, common));
}

async function worktreeEntry(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
