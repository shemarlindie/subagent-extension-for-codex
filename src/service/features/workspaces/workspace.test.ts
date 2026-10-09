import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test } from "vitest";

import { git } from "./git.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "workspace-git-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Larger than a pipe buffer, so the write is still pending when Git exits.
const input = "x".repeat(8 * 1024 * 1024);

test("git ignores input left unread by a command that exits at once", async () => {
  const unhandled: unknown[] = [];
  const onUncaught = (error: unknown) => unhandled.push(error);
  process.on("uncaughtException", onUncaught);

  try {
    for (let i = 0; i < 5; i++)
      assert.match(await git(dir, ["--version"], undefined, input), /^git /);

    // Let any stream error emitted after the exit surface.
    await new Promise((done) => setTimeout(done, 50));
  } finally {
    process.off("uncaughtException", onUncaught);
  }

  assert.deepEqual(unhandled, []);
});

test("git still rejects a failing command that was given input", async () => {
  await assert.rejects(
    git(dir, ["rev-parse", "--verify", "HEAD"], undefined, input),
    /not a git repository/,
  );
});
