import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, vi } from "vitest";

import { FixtureProvider } from "../../../../dev/service/fixture-provider.js";
import { callTool, isUserTool } from "../../platform/server/tools.js";
import { executionTaskPolicy } from "../providers/task-policy.js";
import { PendingInput } from "../tasks/input/pending-input.js";
import { Control } from "../tasks/runtime/control.js";
import { Store } from "../tasks/storage/store.js";
import { git } from "../workspaces/git.js";
import { Workspaces } from "../workspaces/workspace.js";
import { Projects } from "./projects.js";

// Worker threads don't pass a stubbed HOME to the native homedir().
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return {
    ...actual,
    homedir: () => process.env.HOME ?? actual.homedir(),
  };
});

async function fixture(t: import("vitest").TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "projects-test-")));
  const db = join(dir, "registry.sqlite");
  const store = new Store(db);
  const workspaces = new Workspaces(join(dir, "worktrees"), []);
  const projects = new Projects(store.database, workspaces);

  t.onTestFinished(async () => {
    if (store.database.client.isOpen) store.close();
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

async function removalFixture(t: import("vitest").TestContext) {
  const f = await fixture(t);
  const repository = await f.repo("repo");
  await f.projects.register(repository);
  const provider = new FixtureProvider();

  const control = new Control(
    f.store,
    f.workspaces,
    new Map([[provider.id, provider]]),
  );

  control.projects = f.projects;
  control.stopped = true;
  t.onTestFinished(() => control.close());

  const task = (
    depends_on: string[] = [],
    root = repository,
    owner = "owner",
  ) =>
    control.start(owner, {
      provider: provider.id,
      description: "Preserved task data",
      repository: root,
      depends_on,
    });

  return { ...f, control, repository, task };
}

test("removing project task data deletes dependency leaves before their prerequisites", async (t) => {
  const f = await removalFixture(t);
  const prerequisite = await f.task();
  const dependent = await f.task([prerequisite.id]);
  const leaf = await f.task([dependent.id]);
  const discarded: string[] = [];

  vi.spyOn(f.workspaces, "discard").mockImplementation(async (task) => {
    assert.equal(f.store.get(task.id, "owner").id, task.id);
    discarded.push(task.id);
  });

  await callTool(
    f.control,
    "owner",
    "app_remove_project",
    { repository: f.repository, delete_tasks: true },
    "user",
  );

  assert.deepEqual(discarded, [leaf.id, dependent.id, prerequisite.id]);
  assert.deepEqual(f.store.all(), []);
  assert.deepEqual(f.projects.list(), []);
  assert.throws(() => f.store.events(leaf.id, "owner"), /Task not found/);
});

test("an outside-project dependent blocks project task removal before changing data", async (t) => {
  const f = await removalFixture(t);
  const outside = await f.repo("outside");
  await f.projects.register(outside);
  const prerequisite = await f.task();
  const dependent = await f.task([prerequisite.id], outside);
  const before = f.store.all();
  const discard = vi.spyOn(f.workspaces, "discard");

  await assert.rejects(
    f.control.removeProject("owner", f.repository, true),
    new RegExp(`${dependent.id}.*another project.*depends`),
  );

  assert.equal(discard.mock.calls.length, 0);
  assert.deepEqual(f.store.all(), before);
  assert.equal(await f.projects.resolve(f.repository), f.repository);
});

test("failed project cleanup keeps approval and remaining tasks and reports partial deletion", async (t) => {
  const f = await removalFixture(t);
  const prerequisite = await f.task();
  const dependent = await f.task([prerequisite.id]);

  vi.spyOn(f.workspaces, "discard").mockImplementation(async (task) => {
    if (task.id === prerequisite.id) throw new Error("Worktree cleanup failed");
  });

  await assert.rejects(
    f.control.removeProject("owner", f.repository, true),
    /approval is retained.*Some extension task data may already be removed.*Worktree cleanup failed/,
  );

  assert.throws(() => f.store.get(dependent.id, "owner"), /not found/i);
  assert.equal(f.store.get(prerequisite.id, "owner").id, prerequisite.id);
  assert.equal(await f.projects.resolve(f.repository), f.repository);
  f.control.rename("owner", prerequisite.id, "Retry cleanup");
  vi.mocked(f.workspaces.discard).mockResolvedValue(undefined);
  await f.control.removeProject("owner", f.repository, true);
  assert.deepEqual(f.store.all(), []);
  assert.deepEqual(f.projects.list(), []);
});

test("project removal locks new tasks, dependencies, and every batch member during cleanup", async (t) => {
  const f = await removalFixture(t);
  const outside = await f.repo("outside");
  await f.projects.register(outside);
  const prerequisite = await f.task();
  const dependent = await f.task([prerequisite.id]);
  let release!: () => void;
  let entered!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });

  vi.spyOn(f.workspaces, "discard")
    .mockImplementationOnce(async () => {
      entered();
      await gate;
    })
    .mockResolvedValue(undefined);

  const removal = f.control.removeProject("owner", f.repository, true);
  await started;

  try {
    await assert.rejects(f.task(), /being (?:removed|deleted)/);

    await assert.rejects(
      f.task([prerequisite.id], outside),
      /being (?:removed|deleted)/,
    );

    for (const task of [prerequisite, dependent]) {
      assert.throws(
        () => f.control.rename("owner", task.id, "Changed"),
        /being (?:removed|deleted)/,
      );

      await assert.rejects(
        f.control.send("owner", task.id, "Continue", "user"),
        /being (?:removed|deleted)/,
      );

      await assert.rejects(
        f.control.delete("owner", task.id),
        /being (?:removed|deleted)/,
      );
    }

    await assert.rejects(
      f.control.removeProject("owner", f.repository),
      /being (?:removed|deleted)/,
    );

    assert.equal(f.store.all().length, 2);
  } finally {
    release();
    await removal;
  }

  assert.deepEqual(f.store.all(), []);

  assert.deepEqual(
    f.projects.list().map((project) => project.repository),
    [outside],
  );
});

test("project registration requires user authority and grants live persistent access only after submission", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("new-project");
  const control = new Control(f.store, f.workspaces, new Map());
  control.projects = f.projects;
  const tool = "app_register_project";
  assert.equal(isUserTool(tool), true);
  assert.equal(isUserTool("app_browse_project"), true);

  await assert.rejects(
    callTool(control, "owner", tool, { repository }),
    /user interface/i,
  );

  await assert.rejects(
    callTool(control, "owner", "app_browse_project", {}),
    /user interface/i,
  );

  await assert.rejects(f.projects.resolve(repository), /outside allowed roots/);
  assert.deepEqual(f.projects.list(), []);

  await assert.rejects(
    callTool(control, "owner", tool, { repository: "relative/path" }, "user"),
    /absolute/i,
  );

  await mkdir(join(repository, "src"));

  await assert.rejects(
    callTool(
      control,
      "owner",
      tool,
      { repository: join(repository, "src") },
      "user",
    ),
    new RegExp(`inside the Git repository .*Add ${repository} instead`),
  );

  assert.deepEqual(f.projects.list(), []);

  assert.deepEqual(
    await callTool(control, "owner", tool, { repository }, "user"),
    { repository, kind: "repository" },
  );

  assert.equal(await f.projects.resolve(repository), repository);
  await callTool(control, "owner", tool, { repository }, "user");
  assert.equal(f.projects.list().length, 1);
  const reopened = new Store(f.db);

  try {
    const registry = new Projects(
      reopened.database,
      new Workspaces(join(f.dir, "reopened-worktrees"), []),
    );

    assert.equal(await registry.resolve(repository), repository);
  } finally {
    reopened.close();
  }
});

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
      cliStore.database,
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

  assert.deepEqual(
    f.projects.list().map((project) => project.repository),
    [repository],
  );
});

test("project names are trimmed, persisted, and retained by repeated registration", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("repo");
  await f.projects.register(repository);
  f.projects.rename(repository, "  My project  ");
  await f.projects.register(repository);

  assert.deepEqual(
    f.projects.list().map((project) => project.name),
    ["My project"],
  );

  const reopened = new Store(f.db);

  try {
    const registry = new Projects(
      reopened.database,
      new Workspaces(join(f.dir, "reopened-worktrees"), []),
    );

    assert.deepEqual(
      registry.list().map((project) => project.name),
      ["My project"],
    );

    registry.rename(repository, "x".repeat(200));

    assert.deepEqual(
      f.projects.list().map((project) => project.name),
      ["x".repeat(200)],
    );
  } finally {
    reopened.close();
  }
});

test("project rename rejects invalid names and unregistered roots without changing approval", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("repo");
  const missing = await f.repo("missing");
  await f.projects.register(repository);

  for (const name of ["", " \n\t ", "x".repeat(201)]) {
    await assert.rejects(async () => f.projects.rename(repository, name));
  }

  await assert.rejects(async () => f.projects.rename(missing, "Missing"));

  assert.deepEqual(
    f.projects.list().map((project) => project.name),
    ["repo"],
  );

  assert.equal(await f.projects.resolve(repository), repository);
});

test("project removal is idempotent even after its directory disappears", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("gone/repo");
  const retained = await f.repo("retained");
  await f.projects.register(repository);
  await f.projects.register(retained);
  await rm(join(f.dir, "gone"), { recursive: true });
  await writeFile(join(f.dir, "gone"), "no longer a directory");
  f.projects.remove(repository);
  f.projects.remove(repository);

  assert.deepEqual(
    f.projects.list().map((project) => project.repository),
    [retained],
  );

  assert.equal(await f.projects.resolve(retained), retained);
  assert.deepEqual(f.workspaces.allowedRoots, [retained]);
});

test("removing a saved root by another spelling revokes it", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("linked/repo");
  await f.projects.register(repository);
  const alias = join(f.dir, "alias");
  await symlink(repository, alias);
  f.projects.remove(alias);

  assert.deepEqual(f.projects.list(), []);
  await assert.rejects(f.projects.resolve(repository), /outside allowed roots/);
});

test("removing a listed child preserves its explicit parent grant", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("parent/repo");
  const parent = join(f.dir, "parent");
  await f.projects.register(parent, "parent");
  await f.projects.register(repository);
  f.projects.remove(repository);

  assert.deepEqual(f.projects.list(), [
    { repository: parent, name: "parent", kind: "parent" },
  ]);

  assert.equal(await f.projects.resolve(repository), repository);
});

test("removing approval preserves task history and files but blocks new tasks and continuation", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("repo");

  execFileSync("git", [
    "-C",
    repository,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  ]);

  const file = join(repository, "keep.txt");
  await writeFile(file, "User file");
  await f.projects.register(repository);
  const provider = new FixtureProvider();

  const control = new Control(
    f.store,
    f.workspaces,
    new Map([[provider.id, provider]]),
  );

  control.projects = f.projects;

  try {
    const task = await control.start("owner", {
      provider: "fixture",
      description: "Review [input]",
      repository,
    });

    for (let i = 0; i < 300; i++) {
      if (f.store.get(task.id, "owner").status === "waiting") break;
      await new Promise((done) => setTimeout(done, 10));
    }

    assert.equal(f.store.get(task.id, "owner").status, "waiting");
    await control.interrupt("owner", task.id);
    const before = f.store.get(task.id, "owner");
    f.projects.remove(repository);
    assert.deepEqual(f.store.get(task.id, "owner"), before);
    assert.equal(await realpath(file), file);

    await assert.rejects(
      control.start("owner", {
        provider: "fixture",
        description: "Another task",
        repository,
      }),
      /outside allowed roots/,
    );

    await assert.rejects(
      control.send("owner", task.id, "Continue", "user"),
      /outside allowed roots/,
    );

    assert.equal(f.store.all().length, 1);
    assert.deepEqual(f.store.get(task.id, "owner"), before);
  } finally {
    await control.close();
  }
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

    if (missing === "parent replaced with file") {
      await writeFile(join(f.dir, "unavailable"), "no longer a directory");
    }

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

    if (missing === "parent replaced with file") {
      await rm(join(f.dir, "unavailable"));
    }

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
        title: "relative",
        description: "relative",
        repository: "relative/project",
      }),
      /absolute repository path/,
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
        await git(started.workspace, [
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ])
      ).trim(),
      join(b, ".git"),
    );

    await control.interrupt("owner", task.id);

    const { task: resumed } = await control.send(
      "owner",
      task.id,
      "Continue [input]",
      "user",
    );

    assert.equal(resumed.repository, b);
    assert.equal(resumed.workspace, started.workspace);
    await until(() => f.store.get(task.id, "owner").status === "waiting");
    assert.equal(f.store.get(task.id, "owner").repository, b);
  } finally {
    await control.close();
  }
});

test("project task-data removal stops active input waits and preserves checkout files", async (t) => {
  const f = await removalFixture(t);

  execFileSync("git", [
    "-C",
    f.repository,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  ]);

  const file = join(f.repository, "keep.txt");
  await writeFile(file, "User file");
  f.control.stopped = false;

  const task = await f.control.start("owner", {
    provider: "fixture",
    repository: f.repository,
    description: "Review [input]",
  });

  for (let i = 0; i < 300; i++) {
    if (f.store.get(task.id, "owner").status === "waiting") break;
    await new Promise((done) => setTimeout(done, 10));
  }

  assert.equal(f.store.get(task.id, "owner").status, "waiting");
  await f.control.removeProject("owner", f.repository, true);
  assert.equal(f.control.active.has(task.id), false);
  assert.deepEqual(f.store.all(), []);
  assert.deepEqual(f.projects.list(), []);
  assert.equal(await realpath(file), file);
});

test("project removal retains mutation locks until every interrupted turn settles", async (t) => {
  const f = await removalFixture(t);
  const first = await f.task();
  const second = await f.task();
  let release!: () => void;
  let fail!: (error: Error) => void;

  const done = [
    new Promise<void>((_, reject) => {
      fail = reject;
    }),
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  ];

  for (const [index, task] of [first, second].entries()) {
    const abort = new AbortController();
    const taskDone = done[index];
    assert.ok(taskDone);

    f.control.active.set(task.id, {
      task,
      abort,
      done: taskDone,
      input: new PendingInput(task, f.store, executionTaskPolicy, abort.signal),
    });
  }

  const removal = f.control.removeProject("owner", f.repository, true);
  const rejected = assert.rejects(removal, /Stop failed/);
  fail(new Error("Stop failed"));
  for (let i = 0; i < 20; i++) await Promise.resolve();

  assert.throws(
    () => f.control.rename("owner", second.id, "Changed"),
    /being (?:removed|deleted)/,
  );

  release();
  await rejected;
  f.control.active.clear();
  f.control.rename("owner", second.id, "Retry allowed");
  assert.equal(f.projects.list().length, 1);
  assert.equal(f.store.all().length, 2);
});

test("registering, renaming and removing a project each report a change", async (t) => {
  const { store, workspaces, repo } = await fixture(t);
  let changes = 0;
  const projects = new Projects(store.database, workspaces, () => changes++);
  const repository = await repo("changes");

  await projects.register(repository);
  projects.rename(repository, "Renamed");
  projects.remove(repository);
  assert.equal(changes, 3);

  // Nothing changes when a rename fails or the list is only read.
  assert.throws(() => projects.rename(repository, "Gone"), /no longer/);
  projects.list();
  assert.equal(changes, 3);
});

test("a plain folder registers at its exact root and lists without Git", async (t) => {
  const f = await fixture(t);
  const folder = join(f.dir, "notes");
  await mkdir(join(folder, "sub"), { recursive: true });

  assert.deepEqual(await f.projects.register(folder), {
    repository: folder,
    kind: "repository",
  });

  assert.equal((await f.projects.listWithGit())[0]?.git, "none");
  assert.equal(await f.projects.resolve(folder), folder);

  await assert.rejects(
    f.projects.resolve(join(folder, "sub")),
    /outside allowed roots/,
  );
});

test("a project's Git state is reused briefly, then read again", async (t) => {
  const f = await fixture(t);
  const folder = join(f.dir, "notes");
  await mkdir(folder);
  await f.projects.register(folder);
  assert.equal((await f.projects.listWithGit())[0]?.git, "none");

  execFileSync("git", ["init", "-q", folder]);
  assert.equal((await f.projects.listWithGit())[0]?.git, "none");

  const start = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(start + 11_000);
  t.onTestFinished(() => clock.mockRestore());
  assert.equal((await f.projects.listWithGit())[0]?.git, "no_commits");

  await rm(folder, { recursive: true });
  clock.mockReturnValue(start + 22_000);
  assert.equal((await f.projects.listWithGit())[0]?.git, undefined);
});

test("registration rejects folders that are too broad or hold service data", async (t) => {
  const f = await fixture(t);
  const home = join(f.dir, "home");
  const data = join(f.dir, "data");
  await mkdir(join(home, "projects"), { recursive: true });
  await mkdir(join(data, "inner"), { recursive: true });

  vi.stubEnv("HOME", home);
  vi.stubEnv("SUBAGENT_EXTENSION_FOR_CODEX_DATA", data);

  t.onTestFinished(() => {
    vi.unstubAllEnvs();
  });

  await assert.rejects(f.projects.register(home), /too broad/);
  await assert.rejects(f.projects.register(f.dir), /too broad/);
  await assert.rejects(f.projects.register("/"), /too broad/);
  await assert.rejects(f.projects.register(data), /extension's own data/);

  await assert.rejects(
    f.projects.register(join(data, "inner")),
    /extension's own data/,
  );

  await f.projects.register(join(home, "projects"));

  // A name that only starts with dots is still inside its parent.
  const dotted = join(f.dir, "dotted");
  await mkdir(join(dotted, "..data"), { recursive: true });
  vi.stubEnv("SUBAGENT_EXTENSION_FOR_CODEX_DATA", join(dotted, "..data"));
  await assert.rejects(f.projects.register(dotted), /extension's own data/);
});

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
  "a folder the service can't read is not added, starts no task and takes no new turn",
  async (t) => {
    const f = await fixture(t);
    const provider = new FixtureProvider({ turnDelayMs: 0, replyPaceMs: 0 });

    const control = new Control(
      f.store,
      f.workspaces,
      new Map([[provider.id, provider]]),
    );

    control.projects = f.projects;
    t.onTestFinished(() => control.close());

    const blocked = join(f.dir, "blocked");
    const allowed = join(f.dir, "allowed");
    await mkdir(blocked);
    await mkdir(allowed);
    await chmod(blocked, 0o000);
    t.onTestFinished(() => chmod(blocked, 0o755));

    await assert.rejects(
      f.projects.register(blocked),
      /Can't access .*blocked\. On macOS, allow access in System Settings/,
    );

    assert.deepEqual(f.projects.list(), []);
    await f.projects.register(allowed);

    const task = await control.start("owner", {
      provider: provider.id,
      description: "Plain folder task",
      repository: allowed,
    });

    await vi.waitFor(() =>
      assert.equal(f.store.get(task.id, "owner").status, "completed"),
    );

    await chmod(allowed, 0o000);
    t.onTestFinished(() => chmod(allowed, 0o755));

    await assert.rejects(
      control.start("owner", {
        provider: provider.id,
        description: "Blocked at start",
        repository: allowed,
      }),
      /Can't access .*allowed/,
    );

    await assert.rejects(
      control.send("owner", task.id, "Continue", "user"),
      /Can't access .*allowed/,
    );
  },
);
