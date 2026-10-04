import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// Package root: this module lives in src/service/ (or dist/service/ when built).
export const installRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function dataDirectory(env = process.env) {
  if (env.CODEX_SUBAGENT_EXTENSION_DATA)
    return resolve(env.CODEX_SUBAGENT_EXTENSION_DATA);
  // Preserve the previous packaged installation's database until explicitly migrated.
  const legacy = join(installRoot, ".codex-subagent-extension");
  if (existsSync(join(legacy, "console.sqlite"))) return legacy;

  return join(homedir(), ".local", "share", "codex-subagent-extension");
}
