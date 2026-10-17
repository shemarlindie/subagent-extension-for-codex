import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { gitRepositoryRoot } from "./git.js";
import { Workspaces } from "./workspace.js";

let directory: string;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "git-validation-")));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function stalledGit() {
  const bin = join(directory, "bin");
  const pidFile = join(directory, "git.pid");
  await mkdir(bin);

  await writeFile(
    join(bin, "git"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o700 },
  );

  vi.stubEnv("PATH", bin);

  return pidFile;
}

test("repository validation bounds and kills Git even if it ignores graceful shutdown", async () => {
  const pidFile = await stalledGit();
  const workspaces = new Workspaces(join(directory, "workspaces"), [directory]);

  await assert.rejects(
    workspaces.repository(directory),
    /Git repository validation did not finish within 5 seconds/,
  );

  const pid = Number(await readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("an unapproved root is rejected before running Git", async () => {
  const pidFile = await stalledGit();
  const workspaces = new Workspaces(join(directory, "workspaces"), []);

  await assert.rejects(
    workspaces.repository(directory),
    /outside allowed roots/,
  );

  await assert.rejects(readFile(pidFile), { code: "ENOENT" });
});

test("bounded validation preserves Git errors and canonical-root approval", async () => {
  await assert.rejects(gitRepositoryRoot(directory), /not a git repository/);
  execFileSync("git", ["init", "-q", directory]);
  const workspaces = new Workspaces(join(directory, "workspaces"), [directory]);
  assert.equal(await workspaces.repository(directory), directory);

  const child = join(directory, "child");
  await mkdir(child);
  await assert.rejects(workspaces.repository(child), /Use repository root/);
});
