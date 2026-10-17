import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "codex-subagent-extension";

/** Default service port. */
export const defaultPort = 17317;

function isPackageManifest(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).name === packageName;
  } catch {
    // Missing or unreadable manifests belong to directories between the module and the package.
    return false;
  }
}

/**
 * The package root above a module: the nearest directory whose package.json
 * names this package. It holds for source modules, built entries and bundle
 * chunks alike, and never depends on the working directory.
 */
export function findPackageRoot(moduleUrl: string | URL) {
  const start = dirname(fileURLToPath(moduleUrl));

  for (let directory = start; ; directory = dirname(directory)) {
    if (isPackageManifest(join(directory, "package.json"))) return directory;

    if (dirname(directory) === directory) {
      throw new Error(
        `No ${packageName} package.json found above ${start}; the installation is incomplete`,
      );
    }
  }
}

export const installRoot = findPackageRoot(import.meta.url);

/** A path inside the installed package. */
export function packagePath(...segments: string[]) {
  return join(installRoot, ...segments);
}

/** Reads a file shipped with the package, naming it when the installation lacks it. */
export function readPackageFile(...segments: string[]) {
  try {
    return readFileSync(packagePath(...segments), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

    throw new Error(
      `Missing package file ${segments.join("/")} in ${installRoot}`,
      { cause: error },
    );
  }
}

export function dataDirectory(env = process.env) {
  if (env.CODEX_SUBAGENT_EXTENSION_DATA) {
    return resolve(env.CODEX_SUBAGENT_EXTENSION_DATA);
  }

  return join(homedir(), ".local", "share", "codex-subagent-extension");
}
