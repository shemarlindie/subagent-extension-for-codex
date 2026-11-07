import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { scalarText } from "../../../../../shared/text.js";
import { dataDirectory } from "../../../../platform/service/runtime.js";
import { adminTokenPath } from "../../../../platform/service/token.js";
import { within } from "../../../workspaces/workspace.js";

/** File tools that name a single file. */
const fileTools = ["Read", "Edit", "Write", "NotebookEdit"];
/** Search tools that name a folder, which may hold the token. */
const searchTools = ["Grep", "Glob"];

/** The path a file or search tool names. Search tools default to the workspace. */
const toolPath = (input: Record<string, unknown>, workspace: string) =>
  scalarText(input.file_path ?? input.notebook_path ?? input.path, workspace);

/**
 * The admin token's real path. With it, a worker could ask the service for a
 * task without the sandbox it runs in.
 */
export async function claudeAdminToken() {
  return adminTokenPath(await actualPath(dataDirectory()));
}

/**
 * A deny rule for the token. `//` starts an absolute path, and Claude Code
 * matches Windows paths in their POSIX form, `/c/...`.
 */
export function adminTokenRule(token: string) {
  const posix = token
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
    .replaceAll("\\", "/");

  return `Read(/${posix})`;
}

/** A path with symlinks resolved. A new file resolves through its folder. */
async function actualPath(path: string) {
  try {
    return await realpath(path);
  } catch {
    try {
      return join(await realpath(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

/**
 * Whether a file tool targets the token, or a search tool covers a folder
 * that holds it. Org policy can drop the deny rule, so the task's hook checks
 * this too.
 */
export async function touchesAdminToken(
  token: string,
  tool: string,
  input: Record<string, unknown>,
  workspace: string,
) {
  const single = fileTools.includes(tool);
  if (!single && !searchTools.includes(tool)) return false;

  const target = await actualPath(
    resolve(workspace, toolPath(input, workspace)),
  );

  return single ? target === token : within(target, token);
}
