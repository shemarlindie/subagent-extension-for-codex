import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { SandboxSettings } from "@anthropic-ai/claude-agent-sdk";

import type { ClaudePolicy } from "../../../../../shared/providers/claude/permissions.js";
import type { Task } from "../../../../../shared/tasks/model.js";
import { dataDirectory } from "../../../../platform/service/runtime.js";
import { git } from "../../../workspaces/git.js";

// The extension's own credentials never reach delegated sessions. Claude
// credentials come from the user's configuration, not a subscription token.
const privateVariable = (name: string) =>
  name.startsWith("CODEX_SUBAGENT_EXTENSION_") ||
  name.startsWith("OPENAI_") ||
  name === "CLAUDE_CODE_OAUTH_TOKEN";

/** The service environment for the native harness, or only Claude authentication and basic process settings when filtered. */
export function claudeEnvironment(
  source: NodeJS.ProcessEnv,
  mode: ClaudePolicy["environment"],
): NodeJS.ProcessEnv {
  if (mode === "inherit") {
    return Object.fromEntries(
      Object.entries(source).filter(
        ([name, value]) => value !== undefined && !privateVariable(name),
      ),
    );
  }

  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "CLAUDE_CONFIG_DIR",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
  ];

  return Object.fromEntries(
    allowed.flatMap((name) =>
      source[name] === undefined ? [] : [[name, source[name]]],
    ),
  );
}

/** Native Bash restrictions; the model/API harness itself is outside this sandbox. */
export async function claudeSandbox(task: Task): Promise<SandboxSettings> {
  if (!task.workspace) throw new Error("Task workspace unavailable");
  const workspace = await realpath(task.workspace);
  const repository = await realpath(task.repository);
  // The service creates it before any task runs; tests may not.
  const data = await realpath(dataDirectory()).catch(() => dataDirectory());

  const gitDirectory = await realpath(
    resolve(
      workspace,
      (await git(workspace, ["rev-parse", "--git-common-dir"])).trim(),
    ),
  );

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
      // The data directory holds the admin token and may sit outside home.
      denyRead: [
        ...new Set([
          homedir(),
          data,
          repository,
          dirname(workspace),
          process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
        ]),
      ],
      allowRead: [workspace, gitDirectory],
      allowWrite: [workspace],
      denyWrite: [gitDirectory, join(workspace, ".git")],
    },
  };
}
