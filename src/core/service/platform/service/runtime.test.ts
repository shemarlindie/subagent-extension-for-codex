import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { test } from "vitest";

import { findPackageRoot } from "./runtime.js";

async function tree(t: import("vitest").TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "package-root-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  return root;
}

async function manifest(directory: string, name: string) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name }));
}

const moduleAt = (...segments: string[]) =>
  pathToFileURL(join(...segments, "module.js"));

test("package root skips other packages' manifests and malformed ones", async (t) => {
  const root = await tree(t);
  await manifest(root, "subagent-extension-for-codex");
  await manifest(join(root, "dist", "vendor"), "some-dependency");
  await writeFile(join(root, "dist", "package.json"), "{ not json");

  assert.equal(findPackageRoot(moduleAt(root, "dist", "vendor", "lib")), root);
});

test("a module outside the package reports the incomplete installation", async (t) => {
  const root = await tree(t);

  assert.throws(
    () => findPackageRoot(moduleAt(root, "dist")),
    /No subagent-extension-for-codex package\.json found above .*the installation is incomplete/,
  );
});
