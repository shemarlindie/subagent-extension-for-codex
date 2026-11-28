import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import type {
  AboutInfo,
  ExtensionBuildInfo,
} from "../../../shared/about/types.js";
import type { Control } from "../../features/tasks/runtime/control.js";
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
  const providers = await Promise.all(
    [...c.providers.values()].flatMap((provider) =>
      provider.about
        ? [provider.about(refresh).then((info) => [provider.id, info] as const)]
        : [],
    ),
  );

  return {
    build,
    installation: existsSync(packagePath("src", "main.ts"))
      ? "checkout"
      : "package",
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      launcher: serviceIdentity().launcher,
      data_directory: dataDirectory(),
    },
    providers: Object.fromEntries(providers),
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
