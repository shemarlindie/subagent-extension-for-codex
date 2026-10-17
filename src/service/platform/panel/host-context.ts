import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import type { Control } from "../../features/tasks/runtime/control.js";
import { gitRepositoryRoot } from "../../features/workspaces/git.js";

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
    const cwd = fileURLToPath(directory);
    if (!isAbsolute(cwd)) return args;
    const root = await gitRepositoryRoot(cwd);

    const repository = c.projects
      ? await c.projects.resolve(root)
      : await c.workspaces.repository(root);

    return { ...args, repository };
  } catch {
    // Unknown/remote/unapproved directories do not grant access or block the UI.
    return args;
  }
}

/** A local Git-root suggestion for review; this does not resolve or grant access. */
export async function hostProjectCandidate(directory?: string) {
  if (!directory) return undefined;

  try {
    const cwd = fileURLToPath(directory);
    if (!isAbsolute(cwd)) return undefined;

    return await realpath(await gitRepositoryRoot(cwd));
  } catch {
    return undefined;
  }
}
