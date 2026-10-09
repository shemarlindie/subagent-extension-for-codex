import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import { packagePath } from "../../../platform/service/runtime.js";

/** The Claude Code binary's file name on this platform. */
export const claudeBinaryName =
  process.platform === "win32" ? "claude.exe" : "claude";

/**
 * The Claude Code executable for this installation. Built code runs the
 * binary the build copied into dist/claude/. Source runs return undefined, so
 * the SDK uses its own platform package from node_modules.
 */
export function claudeExecutable(
  moduleFile = fileURLToPath(import.meta.url),
): string | undefined {
  if (!moduleFile.startsWith(packagePath("dist") + sep)) return undefined;

  return packagePath("dist", "claude", claudeBinaryName);
}
