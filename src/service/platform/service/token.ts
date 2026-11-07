import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Generated tokens are 43 characters; overrides must be comparably unguessable.
const minimumTokenLength = 32;

/** The file that holds the generated admin token. */
export const adminTokenPath = (data: string) => join(data, "admin-token");

export function adminToken(data: string, env = process.env) {
  const override = env.SUBAGENT_EXTENSION_FOR_CODEX_TOKEN;

  if (override !== undefined) {
    if (override.length < minimumTokenLength) {
      throw new Error(
        `SUBAGENT_EXTENSION_FOR_CODEX_TOKEN must be at least ${minimumTokenLength} characters`,
      );
    }

    return override;
  }

  const path = adminTokenPath(data);
  let token: string | undefined;

  try {
    token = readFileSync(path, "utf8").trim();
  } catch {}

  if (!token) {
    token = randomBytes(32).toString("base64url");
    writeFileSync(path, token, { mode: 0o600 });
  }

  // writeFileSync's mode applies only on creation; tighten pre-existing files too.
  chmodSync(path, 0o600);

  return token;
}
