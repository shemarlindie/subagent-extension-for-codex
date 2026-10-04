import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { adminToken } from "../src/service/token.js";

async function data(t: import("vitest").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "ac-token-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

const mode = async (path: string) => (await stat(path)).mode & 0o777;

test("generates an owner-only token once and reuses it", async (t) => {
  const dir = await data(t);
  const token = adminToken(dir, {});
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await readFile(join(dir, "admin-token"), "utf8"), token);
  assert.equal(await mode(join(dir, "admin-token")), 0o600);
  assert.equal(adminToken(dir, {}), token);
});

test("regenerates an empty token file and tightens its permissions", async (t) => {
  const dir = await data(t);
  const path = join(dir, "admin-token");
  await writeFile(path, "\n", { mode: 0o644 });
  const token = adminToken(dir, {});
  assert.equal(token.length, 43);
  assert.equal(await mode(path), 0o600);
});

test("tightens permissions on an existing token file", async (t) => {
  const dir = await data(t);
  const path = join(dir, "admin-token");
  await writeFile(path, "persisted-token\n", { mode: 0o644 });
  assert.equal(adminToken(dir, {}), "persisted-token");
  assert.equal(await mode(path), 0o600);
});

test("rejects short overrides outside fixture mode without touching the file", async (t) => {
  const dir = await data(t);

  assert.throws(
    () => adminToken(dir, { CODEX_SUBAGENT_EXTENSION_TOKEN: "short" }),
    /at least 32 characters/,
  );

  assert.throws(
    () =>
      adminToken(dir, {
        CODEX_SUBAGENT_EXTENSION_TOKEN: "short",
        CODEX_SUBAGENT_EXTENSION_PROVIDER: "claude",
      }),
    /at least 32 characters/,
  );

  const long = "x".repeat(32);
  assert.equal(adminToken(dir, { CODEX_SUBAGENT_EXTENSION_TOKEN: long }), long);
  await assert.rejects(stat(join(dir, "admin-token")));
});

test("allows the demo's short override for fixture-only services", async (t) => {
  const dir = await data(t);

  assert.equal(
    adminToken(dir, {
      CODEX_SUBAGENT_EXTENSION_TOKEN: "local-demo-only",
      CODEX_SUBAGENT_EXTENSION_PROVIDER: "fixture",
    }),
    "local-demo-only",
  );
});
