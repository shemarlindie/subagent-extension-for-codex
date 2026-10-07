import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Package root: this module lives in src/platform/service/ (or dist/platform/service/ when built).
export const installRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function dataDirectory(env = process.env) {
  if (env.CODEX_SUBAGENT_EXTENSION_DATA)
    return resolve(env.CODEX_SUBAGENT_EXTENSION_DATA);

  return join(homedir(), ".local", "share", "codex-subagent-extension");
}
