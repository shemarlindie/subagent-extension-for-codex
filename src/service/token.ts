import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// Generated tokens are 43 characters; overrides must be comparably unguessable.
export const minimumTokenLength = 32;

export function adminToken(data: string, env = process.env) {
  const override = env.CODEX_SUBAGENT_EXTENSION_TOKEN;

  if (override !== undefined) {
    // Fixture-only services run no real workers, so the demo's short token is allowed.
    if (
      override.length < minimumTokenLength &&
      env.CODEX_SUBAGENT_EXTENSION_PROVIDER !== "fixture"
    )
      throw new Error(
        `CODEX_SUBAGENT_EXTENSION_TOKEN must be at least ${minimumTokenLength} characters`,
      );

    return override;
  }

  const path = join(data, "admin-token");
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
