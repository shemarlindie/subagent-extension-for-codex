import { resolve } from "node:path";

import { within } from "../../../workspaces/workspace.js";
import { actualPath, rulePath, toolPath } from "./admin-token.js";

/** File tools that change the file they name. */
const writeTools = ["Edit", "Write", "NotebookEdit"];

/**
 * Deny rules that keep the attachment folder fixed. Inside the sandbox,
 * Claude Code applies the Edit rule to every program.
 */
export function attachmentRules(folder: string) {
  const files = `${rulePath(folder)}/**`;

  return [`Edit(${files})`, `Write(${files})`];
}

/**
 * Whether a file tool would change an attachment. Org policy can drop the
 * deny rules, so the task's hook checks this too.
 */
export async function editsAttachment(
  folder: string,
  tool: string,
  input: Record<string, unknown>,
  workspace: string,
) {
  if (!writeTools.includes(tool)) return false;

  return within(
    folder,
    await actualPath(resolve(workspace, toolPath(input, workspace))),
  );
}
