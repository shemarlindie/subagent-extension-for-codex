import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionBuildInfo } from "../../../shared/about/types.js";

/** Also used by the bundler, so packaged SDK versions survive without node_modules. */
export function collectBuildInfo(root: string): ExtensionBuildInfo {
  const version = (path: string): string =>
    (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;

  const info: ExtensionBuildInfo = {
    version: version(join(root, "package.json")),
    sdks: [
      "@anthropic-ai/claude-agent-sdk",
      "@modelcontextprotocol/sdk",
      "@modelcontextprotocol/ext-apps",
    ].map((name) => ({
      name,
      version: version(join(root, "node_modules", name, "package.json")),
    })),
  };

  // Require this checkout's marker so Git never identifies an enclosing repository.
  if (existsSync(join(root, ".git"))) {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

    try {
      info.commit = git("rev-parse", "HEAD");

      info.dirty = Boolean(
        git("status", "--porcelain", "--untracked-files=normal"),
      );
    } catch {
      // Source archives and checkouts without Git can still report their versions.
    }
  }

  return info;
}
