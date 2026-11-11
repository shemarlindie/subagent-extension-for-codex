import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { test, type TestContext } from "vitest";

const exec = promisify(execFile);
const script = resolve("scripts/prepare-release.mjs");
const marketplace = ".agents/plugins/marketplace.json";

/** A main checkout at 0.1.0 with a bare origin and a fake gh that records its arguments. */
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "prepare-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  const checkout = join(root, "checkout");
  const bin = join(root, "bin");
  const ghArgs = join(root, "gh-args");

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GH_ARGS: ghArgs,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };

  const git = (...args: string[]) =>
    exec("git", ["-C", checkout, ...args], { env });

  await mkdir(join(checkout, ".agents/plugins"), { recursive: true });
  await mkdir(bin);

  const files = {
    "package.json": {
      name: "pkg",
      version: "0.1.0",
      repository: { url: "git+https://github.com/owner/pkg.git" },
    },
    "package-lock.json": {
      name: "pkg",
      version: "0.1.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "pkg", version: "0.1.0" } },
    },
    "plugin.json": { name: "pkg", version: "0.1.0" },
  };

  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(checkout, name), JSON.stringify(content, null, 2));
  }

  // The real marketplace, whose formatting the script must keep.
  await copyFile(marketplace, join(checkout, marketplace));

  await writeFile(
    join(checkout, "CHANGELOG.md"),
    "# Changelog\n\nIntro.\n\n## 0.1.0\n\nFirst.\n",
  );

  await writeFile(
    join(bin, "gh"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$GH_ARGS"\n',
  );

  await chmod(join(bin, "gh"), 0o755);

  await exec("git", [
    "init",
    "-q",
    "--bare",
    "-b",
    "main",
    join(root, "origin.git"),
  ]);

  await exec("git", ["init", "-q", "-b", "main", checkout]);
  await git("add", ".");
  await git("commit", "-qm", "initial");
  await git("remote", "add", "origin", join(root, "origin.git"));
  await git("tag", "v0.1.0");
  await git("push", "-q", "-u", "origin", "main", "v0.1.0");

  return {
    checkout,
    git,
    ghArgs,
    notes: (text: string) => appendFile(join(checkout, "CHANGELOG.md"), text),
    /** Runs the script, answering its confirmation when it picks the version. */
    prepare: (version?: string, answer = "") => {
      const run = exec(
        process.execPath,
        [script, ...(version ? [version] : [])],
        { cwd: checkout, env },
      );

      run.child.stdin?.end(answer);

      return run;
    },
  };
}

// Fake gh is a shell script.
test.skipIf(process.platform === "win32")(
  "drafts the notes and opens a draft PR whose one commit sets every version",
  async (t) => {
    const { git, ghArgs, prepare } = await fixture(t);

    for (const subject of ["feat(panel): add a setting", "docs: explain it"]) {
      await git("commit", "-q", "--allow-empty", "-m", subject);
    }

    await git("push", "-q");

    await prepare("0.2.0-beta.1");

    const branch = "origin/chore/release-v0.2.0-beta.1";

    const show = async (path: string) =>
      (await git("show", `${branch}:${path}`)).stdout;

    assert.equal(
      (await git("log", "--format=%s", `main..${branch}`)).stdout,
      "chore(release): v0.2.0-beta.1\n",
    );

    assert.equal(
      (await git("diff", "--name-only", "main", branch)).stdout,
      `.agents/plugins/marketplace.json
CHANGELOG.md
package-lock.json
package.json
plugin.json
`,
    );

    // Both sections appear, listing only feat and fix commits or saying None.
    assert.equal(
      await show("CHANGELOG.md"),
      `# Changelog

Intro.

## 0.2.0-beta.1

### Features

- Add a setting

### Fixes

None

## 0.1.0

First.
`,
    );

    for (const path of ["package.json", "plugin.json"]) {
      assert.equal(JSON.parse(await show(path)).version, "0.2.0-beta.1");
    }

    const lock = JSON.parse(await show("package-lock.json"));
    assert.equal(lock.packages[""].version, "0.2.0-beta.1");

    // Only the version changes in the marketplace, so its formatting stays.
    assert.equal(
      (await git("diff", "--numstat", "main", branch, "--", marketplace))
        .stdout,
      `1\t1\t${marketplace}\n`,
    );

    assert.match(await show(marketplace), /"version": "0\.2\.0-beta\.1"/);

    const gh = await readFile(ghArgs, "utf8");

    assert.deepEqual(gh.split("\n").slice(0, 9), [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      "chore/release-v0.2.0-beta.1",
      "--draft",
      "--title",
      "chore(release): v0.2.0-beta.1",
    ]);

    assert.ok(
      gh.includes(
        "https://github.com/owner/pkg/blob/chore/release-v0.2.0-beta.1/CHANGELOG.md#020-beta1",
      ),
      gh,
    );
  },
);

test.skipIf(process.platform === "win32")(
  "picks the next version from the commits since the last release",
  async (t) => {
    const { git, prepare } = await fixture(t);

    /** Adds commits on main and prepares, returning the release branch. */
    const next = async (...messages: string[]) => {
      await git("switch", "-q", "main");

      for (const message of messages) {
        await git("commit", "-q", "--allow-empty", "-m", message);
      }

      await git("push", "-q", "origin", "main", "--tags");
      await prepare(undefined, "y\n");

      return (await git("branch", "--show-current")).stdout.trim();
    };

    assert.equal(await next("fix: a fix"), "chore/release-v0.1.1");
    assert.equal(await next("feat: a feature"), "chore/release-v0.2.0");

    /** Tags main as released, as the Release workflow and merge would. */
    const release = async (tag: string) => {
      await git("switch", "-q", "main");
      await git("tag", tag);
    };

    // Before 1.0, a breaking change bumps the minor version.
    await release("v0.2.0");

    assert.equal(
      await next("refactor!: drop a setting"),
      "chore/release-v0.3.0",
    );

    await release("v1.0.0");

    assert.equal(
      await next(
        "fix: a fix",
        "refactor: rework\n\nBREAKING CHANGE: drops a setting",
      ),
      "chore/release-v2.0.0",
    );

    // A squashed release pull request leaves the tag off main.
    await git("tag", "v2.0.0");
    await git("switch", "-q", "main");
    await git("merge", "-q", "--squash", "chore/release-v2.0.0");
    await git("commit", "-qm", "chore(release): v2.0.0 (#1)");

    assert.equal(await next("fix: a fix"), "chore/release-v2.0.1");
  },
);

test.skipIf(process.platform === "win32")(
  "keeps notes already written",
  async (t) => {
    const { git, notes, prepare } = await fixture(t);
    await notes("\n## 0.2.0\n\nNotes.\n");

    await prepare("0.2.0");

    assert.equal(
      (await git("show", "origin/chore/release-v0.2.0:CHANGELOG.md")).stdout,
      "# Changelog\n\nIntro.\n\n## 0.1.0\n\nFirst.\n\n## 0.2.0\n\nNotes.\n",
    );
  },
);

test.skipIf(process.platform === "win32")(
  "changes nothing when it refuses or the version is declined",
  async (t) => {
    const { checkout, git, notes, prepare } = await fixture(t);

    const refusal = (version?: string) =>
      prepare(version, "n\n").then(
        () => assert.fail("prepare-release succeeded"),
        (error: { stderr: string }) => error.stderr,
      );

    assert.match(await refusal(), /Cancelled/);
    assert.match(await refusal("0.1.0"), /already at 0\.1\.0/);

    await git("tag", "v0.3.0");
    assert.match(await refusal("0.3.0"), /v0\.3\.0 is already released/);

    await writeFile(join(checkout, "extra"), "");
    assert.match(await refusal("0.2.0"), /Commit or discard/);

    await notes("\n## 0.2.0\n\nNotes.\n");
    assert.match(await refusal("0.2.0"), /Commit or discard/);

    // A newer release tag that main doesn't contain or list.
    const side = await git(
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-m",
      "side",
    );

    await git("tag", "v0.4.0", side.stdout.trim());
    assert.match(await refusal("0.5.0"), /only local/);

    await git("push", "-q", "origin", "v0.4.0");
    assert.match(await refusal("0.5.0"), /Check whether/);

    assert.equal((await git("branch", "--list", "chore/*")).stdout, "");
  },
);
