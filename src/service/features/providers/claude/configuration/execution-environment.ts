import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { SandboxSettings } from "@anthropic-ai/claude-agent-sdk";

import type { Task } from "../../../../../shared/tasks/model.js";
import { dataDirectory } from "../../../../platform/service/runtime.js";
import { git } from "../../../workspaces/git.js";

/** Delegated sessions never receive the extension's own variables or the OpenAI variables Codex may pass. */
const privateVariable = (name: string) =>
  name.startsWith("SUBAGENT_EXTENSION_FOR_CODEX_") ||
  name.startsWith("OPENAI_");

/** The service environment for Claude Code, without private variables. */
export function claudeEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) => value !== undefined && !privateVariable(name),
    ),
  );
}

/** Git metadata stays readable for Git commands and is never writable. */
async function gitSandboxPaths(workspace: string) {
  const gitDirectory = await realpath(
    resolve(
      workspace,
      (await git(workspace, ["rev-parse", "--git-common-dir"])).trim(),
    ),
  );

  return {
    read: [gitDirectory],
    write: [gitDirectory, join(workspace, ".git")],
  };
}

/** Bash sandbox settings for a task. Claude Code itself runs outside this sandbox. */
export async function claudeSandbox(task: Task): Promise<SandboxSettings> {
  if (!task.workspace) throw new Error("Task workspace unavailable");
  const workspace = await realpath(task.workspace);
  const repository = await realpath(task.repository);
  const data = await realpath(dataDirectory());

  const gitPaths = task.no_git
    ? { read: [], write: [] }
    : await gitSandboxPaths(workspace);

  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    excludedCommands: [],
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    network: {
      allowedDomains: [],
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
    },
    filesystem: {
      // The data directory holds the admin token and can be outside the home directory.
      denyRead: [
        ...new Set([
          homedir(),
          data,
          repository,
          dirname(workspace),
          process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
        ]),
      ],
      allowRead: [workspace, ...gitPaths.read],
      allowWrite: [workspace],
      denyWrite: gitPaths.write,
    },
  };
}
