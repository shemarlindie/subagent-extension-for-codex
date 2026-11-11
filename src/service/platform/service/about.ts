import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import compareVersions from "semver/functions/compare.js";

import type {
  AboutInfo,
  ExtensionBuildInfo,
} from "../../../shared/about/types.js";
import { claudeCliSupport } from "../../features/providers/claude/configuration/executable.js";
import { claudeUpgradeInfo } from "../../features/providers/claude/configuration/upgrade.js";
import type { Control } from "../../features/tasks/runtime/control.js";
import { logEvent } from "../logging/logger.js";
import { collectBuildInfo } from "./build-info.js";
import { serviceIdentity } from "./identity.js";
import { dataDirectory, installRoot, packagePath } from "./runtime.js";

declare const __EXTENSION_BUILD_INFO__: ExtensionBuildInfo;

// Bundles capture their identity at build time. Source runs capture it at startup.
const build =
  typeof __EXTENSION_BUILD_INFO__ === "undefined"
    ? collectBuildInfo(installRoot)
    : __EXTENSION_BUILD_INFO__;

export async function aboutInfo(
  c: Control,
  refresh = false,
): Promise<AboutInfo> {
  const claude = await c.providers.get("claude")?.readiness?.({ refresh });
  const version = claude?.details.version;

  const upgrade = claude
    ? await claudeUpgradeInfo(version ? claude.details.executable : undefined)
    : undefined;

  if (refresh) {
    logEvent("info", "about.claude_rechecked", {
      ready: claude?.ready,
      problem: claude?.details.problem,
      version,
      executable: claude?.details.executable,
      installation: upgrade?.installation,
    });
  }

  return {
    build,
    installation: existsSync(packagePath("src", "service", "main.ts"))
      ? "checkout"
      : "package",
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      launcher: serviceIdentity().launcher,
      data_directory: dataDirectory(),
    },
    claude,
    claude_recommended: version
      ? {
          version: claudeCliSupport.paired,
          behind: compareVersions(version, claudeCliSupport.paired) < 0,
        }
      : undefined,
    claude_upgrade: upgrade,
  };
}

const FILE_MANAGERS: Partial<Record<string, string>> = {
  darwin: "open",
  win32: "explorer.exe",
};

/** Opens the data directory in the service host's file manager. */
export async function openDataDirectory() {
  const command = FILE_MANAGERS[process.platform] ?? "xdg-open";

  const child = spawn(command, [dataDirectory()], {
    detached: true,
    stdio: "ignore",
  });

  // Wait only until the process starts, so a missing command fails visibly
  // without tying the request or the service to the file manager's lifetime.
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch (error) {
    throw new Error(`Couldn't run ${command} to open the data directory.`, {
      cause: error,
    });
  }

  child.unref();

  return {};
}
