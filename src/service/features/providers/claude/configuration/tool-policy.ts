import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { scalarText } from "../../../../../shared/text.js";

export const readTools = ["Read", "Glob", "Grep"];
export const writeTools = ["Edit", "Write"];
/** File tools whose target the path guard checks. */
export const pathTools = [...readTools, ...writeTools, "NotebookEdit"];

export const toolPath = (input: Record<string, unknown>, workspace: string) =>
  scalarText(input.file_path ?? input.notebook_path ?? input.path, workspace);

/** Whether a path stays inside the workspace and out of Git metadata, following symlinks. */
export async function inWorkspace(workspace: string, path: string) {
  const target = resolve(workspace, path);
  let actual: string;

  try {
    actual = await realpath(target);
  } catch {
    // New files: resolve the parent to prevent symlink escape.
    try {
      actual = join(await realpath(dirname(target)), basename(target));
    } catch {
      return false;
    }
  }

  const rel = relative(await realpath(workspace), actual);

  return !(
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    rel === ".git" ||
    rel.startsWith(".git/")
  );
}

/** Tools without workspace paths that run after approval; entries ending in `*` match by prefix. */
const approvalTools = ["Bash", "Skill", "mcp__*"];

export const approvalTool = (tool: string) =>
  approvalTools.some((entry) =>
    entry.endsWith("*") ? tool.startsWith(entry.slice(0, -1)) : tool === entry,
  );
