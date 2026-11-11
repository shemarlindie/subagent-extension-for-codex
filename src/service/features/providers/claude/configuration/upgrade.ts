import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { ClaudeUpgradeInfo } from "../../../../../shared/about/types.js";
import { type ClaudeCliEnvironment, locateClaudeCli } from "./executable.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function executable(path: string) {
  try {
    await access(path, constants.X_OK);

    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Inspect local paths only. Never invoke a package manager or an updater. */
export async function claudeUpgradeInfo(
  selected: string | undefined,
  environment: ClaudeCliEnvironment = {
    env: process.env,
    platform: process.platform,
  },
  home = homedir(),
): Promise<ClaudeUpgradeInfo> {
  const unknown = {
    installation: "Unidentified",
    note: "Use the installer or package manager that provided this executable. The service cannot determine a command that targets this installation.",
  };

  if (!selected) {
    return {
      ...unknown,
      note: "Fix the CLI readiness issue, then recheck to identify its installation.",
    };
  }

  if (environment.platform === "win32") return unknown;

  const located = await locateClaudeCli(environment);

  if (!("path" in located) || located.path !== selected) {
    return {
      ...unknown,
      note: "The selected executable changed while checking. Recheck its version before choosing an upgrade command.",
    };
  }

  const pinned =
    "This uses a custom launcher or a version-specific path. Updating may leave that path on the old version. Use the installer's launcher, update the configured path if needed, then restart the service.";

  const brew =
    /^(.*)\/Caskroom\/(claude-code(?:@latest)?)\/[^/]+\/claude$/.exec(selected);

  if (brew) {
    const prefix = brew[1]!;
    const cask = brew[2]!;
    const manager = join(prefix, "bin", "brew");

    const installation =
      cask === "claude-code@latest" ? "Homebrew (latest)" : "Homebrew (stable)";

    if (resolve(located.launcher) !== join(prefix, "bin", "claude")) {
      return { installation, note: pinned };
    }

    if (!(await executable(manager))) {
      return {
        installation,
        note: "The matching Homebrew executable is unavailable. Restore Homebrew for this prefix, or use its installation guidance.",
      };
    }

    return {
      installation,
      command: `${quote(manager)} upgrade --cask ${cask}`,
      note: "Run in a terminal after delegated turns finish. This keeps the installed cask and release channel.",
    };
  }

  const versions = join(home, ".local", "share", "claude", "versions");
  const launcher = join(home, ".local", "bin", "claude");

  if (
    dirname(selected) === versions &&
    /^\d+\.\d+\.\d+$/.test(selected.slice(versions.length + 1))
  ) {
    if (resolve(located.launcher) !== launcher) {
      return { installation: "Native installer", note: pinned };
    }

    return {
      installation: "Native installer",
      command: `${quote(launcher)} update`,
      note: "Run in a terminal after delegated turns finish. Claude's updater follows its configured release channel and policy.",
    };
  }

  if (
    /\/node_modules\/@anthropic-ai\/claude-code(?:-[^/]+)?\//.test(selected)
  ) {
    return {
      installation: "Node package",
      note: "Use the original package manager, installation prefix and release channel. The executable path alone cannot establish whether this is a global npm install or a project dependency.",
    };
  }

  return unknown;
}
