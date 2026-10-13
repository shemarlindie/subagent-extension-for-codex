import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { test } from "vitest";

import {
  findPackageRoot,
  installRoot,
  packagePath,
  packageVersion,
  readPackageFile,
} from "./runtime.js";

const exec = promisify(execFile);

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

test("the installed root is this checkout regardless of working directory", async (t) => {
  assert.equal(installRoot, resolve(import.meta.dirname, "../../../.."));
  assert.equal(packagePath("assets"), join(installRoot, "assets"));

  const elsewhere = await tree(t);

  const { stdout } = await exec(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--input-type=module",
      "-e",
      `import { installRoot } from ${JSON.stringify(import.meta.resolve("./runtime.ts"))}; console.log(installRoot);`,
    ],
    { cwd: elsewhere },
  );

  assert.equal(stdout.trim(), installRoot);
});

test("a missing package file names the file and the installation", () => {
  assert.match(
    readPackageFile("assets", "brand", "brand-glyph-dark.svg"),
    /<svg/,
  );

  assert.throws(() => readPackageFile("assets", "missing.svg"), {
    message: `Missing package file assets/missing.svg in ${installRoot}`,
  });
});

test("the package version comes from the installed package.json", async () => {
  const manifest = JSON.parse(
    await readFile(packagePath("package.json"), "utf8"),
  );

  assert.equal(packageVersion, manifest.version);
});
