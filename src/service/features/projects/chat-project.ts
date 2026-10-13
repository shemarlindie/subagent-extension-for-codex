import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { hostProjectCandidate } from "../../platform/panel/host-context.js";
import type { Control } from "../tasks/runtime/control.js";
import { git } from "../workspaces/git.js";

/** Read transport metadata only; model tool arguments cannot supply this authority. */
export function hostDirectoryFromMeta(meta?: Record<string, unknown>) {
  const state = meta?.["codex/sandbox-state-meta"] as
    { sandboxCwd?: unknown } | undefined;

  const directory = state?.sandboxCwd;

  return typeof directory === "string" && directory.length <= 4096
    ? directory
    : undefined;
}

async function gitRoot(path: string) {
  try {
    return await realpath(
      (await git(path, ["rev-parse", "--show-toplevel"])).trim(),
    );
  } catch {
    return undefined;
  }
}

/** True when an existing grant, including an approved parent, covers the root. */
async function isApproved(c: Control, root: string) {
  try {
    await (c.projects
      ? c.projects.resolve(root)
      : c.workspaces.repository(root));

    return true;
  } catch {
    return false;
  }
}

/**
 * Register the thread's Git root when a task is started from that thread.
 * `repository` is the task target: an explicit target must be inside the thread
 * root, while an omitted one may use it as the task default.
 * Best-effort: a failure here never blocks the task itself.
 */
export async function autoRegisterChatProject(
  c: Control,
  owner: string,
  meta?: Record<string, unknown>,
  repository?: string,
) {
  try {
    if (!c.projects || !c.settings.values(owner).auto_register_chat_project)
      return undefined;
    const root = await hostProjectCandidate(hostDirectoryFromMeta(meta));
    if (!root) return undefined;
    if (
      repository !== undefined &&
      (!isAbsolute(repository) || (await gitRoot(repository)) !== root)
    )
      return undefined;
    // Keep existing grants as they are instead of adding a redundant narrower row.
    if (!(await isApproved(c, root))) await c.projects.register(root);

    return root;
  } catch {
    return undefined;
  }
}

/** Read-only: report the thread's Git root and whether it is already approved. */
export async function currentChatProject(
  c: Control,
  owner: string,
  meta?: Record<string, unknown>,
) {
  const root = await hostProjectCandidate(hostDirectoryFromMeta(meta));
  if (!root)
    throw new Error(
      "The host supplied no usable local project directory. Use the actual absolute repository from the task context, and ask the user to use Add project in the panel if it is not registered.",
    );
  const registered = await isApproved(c, root);

  const auto =
    !!c.projects && c.settings.values(owner).auto_register_chat_project;

  return {
    repository: root,
    registered,
    auto_register_on_task_start: auto,
    // Read-only callers never register; they hand the decision to the user.
    ...(registered
      ? {}
      : {
          next_step: auto
            ? "Starting a task for this repository from this chat adds it automatically. Otherwise ask the user to use Add project in the panel."
            : "Ask the user to use Add project in the panel before delegating to this project.",
        }),
  };
}
