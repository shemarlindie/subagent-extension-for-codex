import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import type { GitState } from "../../../shared/tasks/model.js";
import { assertPlainFolderAllowed } from "../../features/projects/projects.js";
import type { Control } from "../../features/tasks/runtime/control.js";
import { gitState, gitWorkTreeRoot } from "../../features/workspaces/git.js";
import { within } from "../../features/workspaces/workspace.js";

// Version-specific Codex adapter, verified in the public rust-v0.160.0 source.
// Panel context consumes the directory hint. Native permission inheritance
// separately validates the host permission metadata in core/permissions.ts.
export const codexContextCapability = {
  experimental: { "codex/sandbox-state-meta": {} },
};

export async function withHostRepository(
  c: Control,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
) {
  if (args.repository !== undefined || args.task_id !== undefined) return args;

  const state = meta?.["codex/sandbox-state-meta"] as
    { sandboxCwd?: unknown } | undefined;

  const directory = args.host_directory ?? state?.sandboxCwd;
  if (typeof directory !== "string" || directory.length > 4096) return args;

  try {
    const candidate = await hostProjectCandidate(c, directory);
    if (!candidate) return args;

    const repository = c.projects
      ? await c.projects.resolve(candidate.repository)
      : await c.workspaces.repository(candidate.repository);

    return { ...args, repository };
  } catch {
    // Unknown/remote/unapproved directories do not grant access or block the UI.
    return args;
  }
}

/** Only Git roots are added automatically, since a chat's folder may be one-off. */
export const isGitRoot = (candidate: { git?: GitState }) =>
  candidate.git === "ready" || candidate.git === "no_commits";

/** A failed probe of a folder macOS or file permissions may be hiding. */
const permissionDenied = (error: unknown) =>
  /Operation not permitted|Permission denied/.test(
    String((error as { stderr?: unknown }).stderr),
  );

/**
 * A local project suggestion for review; this does not resolve or grant access.
 * The Git root when there is one, otherwise the nearest registered folder, then
 * the directory itself when it could be registered. A blocked folder stays a
 * candidate with `git` unknown, so adding it can say what to change.
 */
export async function hostProjectCandidate(
  c: Control,
  directory?: string,
): Promise<{ repository: string; git?: GitState } | undefined> {
  if (!directory) return undefined;

  try {
    const cwd = fileURLToPath(directory);
    if (!isAbsolute(cwd)) return undefined;

    let root: string | undefined;

    try {
      root = await gitWorkTreeRoot(cwd);
    } catch (error) {
      if (permissionDenied(error)) return { repository: cwd };
      throw error;
    }

    if (root) {
      return {
        repository: root,
        ...(await gitState(root).then(
          (git) => ({ git }),
          () => ({}),
        )),
      };
    }

    const actual = await realpath(cwd);

    const registered = c.projects
      ?.list()
      .filter(
        (project) =>
          project.kind === "repository" && within(project.repository, actual),
      )
      .map((project) => project.repository)
      .sort((a, b) => b.length - a.length)[0];

    if (!registered) await assertPlainFolderAllowed(actual);

    return { repository: registered ?? actual, git: "none" };
  } catch {
    return undefined;
  }
}
