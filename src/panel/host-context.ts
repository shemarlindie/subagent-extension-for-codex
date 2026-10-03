import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import type { Control } from "../core/control.js";
import { git } from "../core/workspace.js";

// Version-specific Codex adapter, verified in the public rust-v0.160.0 source.
// Opting in supplies permission metadata too; consume only the directory hint.
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
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    const repository = c.projects
      ? await c.projects.resolve(root)
      : await c.workspaces.repository(root);
    return { ...args, repository };
  } catch {
    // Unknown/remote/unapproved directories do not grant access or block the UI.
    return args;
  }
}
