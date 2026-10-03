import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  symlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/store.js";
import { Projects } from "../src/projects.js";
import { Workspaces, git } from "../src/workspace.js";
import { Control } from "../src/control.js";
import { FixtureProvider } from "../src/providers/fixture.js";

async function fixture(t: import("node:test").TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "projects-test-")));
  const db = join(dir, "registry.sqlite");
  const store = new Store(db);
  const workspaces = new Workspaces(join(dir, "worktrees"), []);
  const projects = new Projects(store, workspaces);
  t.after(async () => {
    if (store.db.isOpen) store.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function repo(name: string) {
    const path = join(dir, name);
    await mkdir(path, { recursive: true });
    execFileSync("git", ["init", "-q", path]);
    return path;
  }
  return { dir, db, store, workspaces, projects, repo };
}

test("registration persists and a running registry sees CLI database updates", async (t) => {
  const f = await fixture(t);
  const a = await f.repo("a"),
    b = await f.repo("b");
  await f.projects.register(a);
  assert.equal(await f.projects.resolve(a), a);
  await assert.rejects(f.projects.resolve(b), /outside allowed roots/);
  const cliStore = new Store(f.db);
  try {
    const cli = new Projects(
      cliStore,
      new Workspaces(join(f.dir, "unused"), []),
    );
    await cli.register(b);
  } finally {
    cliStore.close();
  }
  assert.equal(await f.projects.resolve(b), b);
  assert.deepEqual(
    f.projects.list().map((p) => p.repository),
    [a, b],
  );
});

test("explicit paths cannot grant access, and current never falls back to another project", async (t) => {
  const f = await fixture(t);
  const a = await f.repo("a"),
    b = await f.repo("b");
  await f.projects.register(a);
  await assert.rejects(
    f.projects.resolve("current"),
    /explicit repository path/,
  );
  await assert.rejects(f.projects.resolve("a"), /absolute/);
  await assert.rejects(f.projects.resolve(b), /outside allowed roots/);
  assert.deepEqual(
    f.projects.list().map((p) => p.repository),
    [a],
  );
  await assert.rejects(f.projects.register("a"), /absolute/);
  await mkdir(join(a, "subdir"));
  await assert.rejects(
    f.projects.register(join(a, "subdir")),
    /repository root/,
  );
});

test("approved parent roots permit child repositories but block siblings and symlink escapes", async (t) => {
  const f = await fixture(t);
  const parent = join(f.dir, "approved");
  const inside = await f.repo("approved/inside");
  const outside = await f.repo("approved-sibling/outside");
  await f.projects.register(parent, "parent");
  assert.equal(await f.projects.resolve(inside), inside);
  await assert.rejects(f.projects.resolve(outside), /outside allowed roots/);
  const escape = join(parent, "escape");
  await symlink(outside, escape, "dir");
  await assert.rejects(f.projects.resolve(escape), /outside allowed roots/);
  const alias = join(f.dir, "alias");
  await symlink(inside, alias, "dir");
  assert.equal(await f.projects.resolve(alias), inside);
  await assert.rejects(f.projects.resolve(parent), /git|repository root/i);
});

test("registered repository aliases are canonicalized before persistence", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("repo");
  const alias = join(f.dir, "alias");
  await symlink(repository, alias, "dir");
  await f.projects.register(alias);
  await f.projects.register(repository);
  assert.equal(f.projects.list().length, 1);
  assert.equal(f.projects.list()[0].repository, repository);
});

for (const missing of ["deleted", "parent replaced with file"] as const) {
  test(`an approved root with a ${missing} path does not block other projects`, async (t) => {
    const f = await fixture(t);
    const unavailable = await f.repo("unavailable/repo");
    const available = await f.repo("available");
    const outside = await f.repo("outside");
    await f.projects.register(unavailable);
    await f.projects.register(available);
    await rm(join(f.dir, "unavailable"), { recursive: true });
    if (missing === "parent replaced with file")
      await writeFile(join(f.dir, "unavailable"), "no longer a directory");

    assert.equal(await f.projects.resolve(available), available);
    assert.deepEqual(
      f.projects.list().map((p) => p.repository),
      [available, unavailable],
      "temporary filesystem failures must not revoke saved approval",
    );
    await assert.rejects(f.projects.resolve(unavailable), {
      code: missing === "deleted" ? "ENOENT" : "ENOTDIR",
    });
    await assert.rejects(f.projects.resolve(outside), /outside allowed roots/);

    if (missing === "parent replaced with file")
      await rm(join(f.dir, "unavailable"));
    await f.repo("unavailable/repo");
    assert.equal(await f.projects.resolve(unavailable), unavailable);
  });
}

test("unexpected approved-root filesystem errors still fail closed", async (t) => {
  const f = await fixture(t);
  const broken = await f.repo("broken");
  const available = await f.repo("available");
  await f.projects.register(broken);
  await f.projects.register(available);
  await rm(broken, { recursive: true });
  await symlink(broken, broken, "dir");
  await assert.rejects(f.projects.resolve(available), { code: "ELOOP" });
});

test("repository approval does not grant access to independent nested repositories", async (t) => {
  const f = await fixture(t);
  const outer = await f.repo("outer");
  const nested = await f.repo("outer/nested");
  await f.projects.register(outer);
  assert.equal(await f.projects.resolve(outer), outer);
  await assert.rejects(
    f.projects.resolve(nested),
    /outside allowed roots|not registered/i,
  );
  await f.projects.register(nested);
  assert.equal(await f.projects.resolve(nested), nested);

  const another = await f.repo("outer/another");
  await assert.rejects(
    f.projects.resolve(another),
    /outside allowed roots|not registered/i,
  );
  await f.projects.register(outer, "parent");
  assert.equal(await f.projects.resolve(another), another);
});

test("tasks and interrupted continuations stay bound to the chosen project", async (t) => {
  const f = await fixture(t);
  const a = await f.repo("a"),
    b = await f.repo("b");
  for (const repo of [a, b]) {
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "initial",
    ]);
    await f.projects.register(repo);
  }
  const provider = new FixtureProvider();
  const control = new Control(
    f.store,
    f.workspaces,
    new Map([[provider.id, provider]]),
    a,
  );
  control.projects = f.projects;
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 300; i++) {
      if (fn()) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error("Timed out waiting for fixture lifecycle");
  };
  try {
    await assert.rejects(
      control.start("owner", {
        provider: "fixture",
        title: "ambiguous",
        description: "ambiguous",
        repository: "current",
      }),
      /explicit repository path/,
    );
    assert.equal(f.store.all().length, 0);
    const task = await control.start("owner", {
      provider: "fixture",
      title: "Review [input]",
      description: "Review [input]",
      repository: b,
    });
    await until(() => f.store.get(task.id, "owner").status === "waiting");
    const started = f.store.get(task.id, "owner");
    assert.equal(started.repository, b);
    assert.equal(started.workspace, b);
    assert.equal(
      (
        await git(started.workspace!, [
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ])
      ).trim(),
      join(b, ".git"),
    );
    await control.stop("owner", task.id, "interrupted");
    control.repository = a;
    const resumed = await control.continue("owner", task.id);
    assert.equal(resumed.repository, b);
    assert.equal(resumed.workspace, started.workspace);
    await until(() => f.store.get(task.id, "owner").status === "waiting");
    assert.equal(f.store.get(task.id, "owner").repository, b);
  } finally {
    await control.close();
  }
});
