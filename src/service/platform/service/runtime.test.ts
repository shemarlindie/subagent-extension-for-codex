import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { test } from "vitest";

import {
  dataDirectory,
  findPackageRoot,
  installRoot,
  readPackageFile,
} from "./runtime.js";

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

test("package root resolves from source, built entries and bundle chunks", async (t) => {
  const root = await tree(t);
  await manifest(root, "codex-subagent-extension");

  for (const location of [
    ["src", "service", "platform", "service"],
    ["dist"],
    ["dist", "chunks"],
  ]) {
    assert.equal(findPackageRoot(moduleAt(root, ...location)), root);
  }
});

test("package root skips other packages' manifests and malformed ones", async (t) => {
  const root = await tree(t);
  await manifest(root, "codex-subagent-extension");
  await manifest(join(root, "dist", "vendor"), "some-dependency");
  await writeFile(join(root, "dist", "package.json"), "{ not json");

  assert.equal(findPackageRoot(moduleAt(root, "dist", "vendor", "lib")), root);
});

test("a module outside the package reports the incomplete installation", async (t) => {
  const root = await tree(t);

  assert.throws(
    () => findPackageRoot(moduleAt(root, "dist")),
    /No codex-subagent-extension package\.json found above .*the installation is incomplete/,
  );
});

test("a missing package file names the file and the installation", () => {
  assert.throws(() => readPackageFile("assets", "missing.svg"), {
    message: `Missing package file assets/missing.svg in ${installRoot}`,
  });
});

test("data directory override is independent of packaged installation directory", () => {
  assert.equal(
    dataDirectory({ CODEX_SUBAGENT_EXTENSION_DATA: "/tmp/custom-agent-data" }),
    "/tmp/custom-agent-data",
  );

  assert.equal(
    dataDirectory({ CODEX_SUBAGENT_EXTENSION_DATA: "relative-agent-data" }),
    resolve("relative-agent-data"),
  );
});
