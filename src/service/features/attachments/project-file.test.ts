import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished, test, vi } from "vitest";

import { readProjectFile } from "./project-file.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();

  return { ...fs, open: vi.fn(fs.open) };
});

/** A temporary folder by its canonical path, as approved projects have. */
async function folder() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "subagent-extension-for-codex-test-")),
  );

  onTestFinished(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

test("a project file reads whole or by line range, within its byte limit", async () => {
  const project = await folder();
  await mkdir(join(project, "folder"));
  await writeFile(join(project, "folder", "note.txt"), "one\ntwo\nthree\n");

  assert.equal(
    (await readProjectFile(project, "folder/note.txt", 1024)).text,
    "one\ntwo\nthree\n",
  );

  assert.equal(
    (
      await readProjectFile(project, "folder/note.txt", 1024, {
        start_line: 2,
        end_line: 2,
      })
    ).text,
    "two\n",
  );

  await assert.rejects(
    readProjectFile(project, "folder/note.txt", 4),
    /attachment limit/,
  );
});

/** Replaces a parent directory during open and optionally restores it. */
async function swapAtOpen(restore: boolean) {
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );

  const dir = await folder();
  const project = join(dir, "project");
  const linked = join(project, "folder");
  await mkdir(linked, { recursive: true });
  await mkdir(join(dir, "outside"));
  await writeFile(join(linked, "note.txt"), "inside\n");
  await writeFile(join(dir, "outside", "note.txt"), "outside\n");

  vi.mocked(open).mockImplementationOnce(async (...args) => {
    await rename(linked, join(project, "aside"));
    // Use a directory junction on Windows for this fixture.
    await symlink(join(dir, "outside"), linked, "junction");
    const file = await fs.open(...args);

    if (restore) {
      await rm(linked);
      await rename(join(project, "aside"), linked);
    }

    return file;
  });

  return project;
}

test("a folder swapped for a link at the open fails the path check", async () => {
  await assert.rejects(
    readProjectFile(await swapAtOpen(false), "folder/note.txt", 1024),
    /folder\/note\.txt changed while it was read/,
  );
});

test("a folder swapped back before the checks fails the identity check", async () => {
  await assert.rejects(
    readProjectFile(await swapAtOpen(true), "folder/note.txt", 1024),
    /folder\/note\.txt changed while it was read/,
  );
});
