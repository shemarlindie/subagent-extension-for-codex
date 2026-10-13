import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { test, type TestContext } from "vitest";

import { Control } from "../tasks/runtime/control.js";
import { Store } from "../tasks/storage/store.js";
import { Workspaces } from "../workspaces/workspace.js";
import { autoRegisterChatProject, currentChatProject } from "./chat-project.js";
import { Projects } from "./projects.js";

async function fixture(t: TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "chat-project-")));
  const store = new Store(join(dir, "db.sqlite"));
  const workspaces = new Workspaces(join(dir, "worktrees"), []);
  const control = new Control(store, workspaces, new Map(), dir);
  control.projects = new Projects(store.database, workspaces);

  t.onTestFinished(async () => {
    await control.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function repo(name: string) {
    const repository = join(dir, name);
    await mkdir(repository, { recursive: true });
    execFileSync("git", ["init", "-q", repository]);

    return repository;
  }

  const enable = (owner = "alice", value = true) =>
    control.settings.update(
      owner,
      { set: { auto_register_chat_project: value } },
      "user",
    );

  return { dir, control, repo, enable };
}

const hostMeta = (directory: string) => ({
  "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(directory).href },
});

test("chat project registration is enabled by default and opt-out is owner scoped", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("project");

  assert.equal(
    f.control.settings.values("alice").auto_register_chat_project,
    true,
  );

  f.enable("alice", false);

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(repository)),
    undefined,
  );

  assert.deepEqual(f.control.projects!.list(), []);

  await assert.rejects(
    f.control.projects!.resolve(repository),
    /outside allowed roots/,
  );

  assert.equal(
    await autoRegisterChatProject(f.control, "bob", hostMeta(repository)),
    repository,
  );
});

test("task-start registration requires the task to target the thread root", async (t) => {
  const f = await fixture(t);

  const repository = await f.repo("project"),
    other = await f.repo("other");

  await mkdir(join(repository, "src"));
  for (const target of [other, "current", "relative/project"])
    assert.equal(
      await autoRegisterChatProject(
        f.control,
        "alice",
        hostMeta(repository),
        target,
      ),
      undefined,
    );
  assert.deepEqual(f.control.projects!.list(), []);

  assert.equal(
    await autoRegisterChatProject(
      f.control,
      "alice",
      hostMeta(repository),
      join(repository, "src"),
    ),
    repository,
  );

  assert.equal(await f.control.projects!.resolve(repository), repository);
});

test("registration failures never block the task start", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("project");

  f.control.projects!.register = async () => {
    throw new Error("database is locked");
  };

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(repository)),
    undefined,
  );
});

test("current chat project lookup is read-only and suggests asking the user", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("project");

  await assert.rejects(
    currentChatProject(f.control, "alice", undefined),
    /Add project/,
  );

  const missing = await currentChatProject(
    f.control,
    "alice",
    hostMeta(repository),
  );

  assert.equal(missing.registered, false);
  assert.equal(missing.auto_register_on_task_start, true);
  assert.match(String(missing.next_step), /Add project/);
  assert.deepEqual(f.control.projects!.list(), []);
  f.enable("alice", false);

  assert.match(
    String(
      (await currentChatProject(f.control, "alice", hostMeta(repository)))
        .next_step,
    ),
    /^Ask the user/,
  );

  await f.control.projects!.register(repository);

  assert.deepEqual(
    await currentChatProject(f.control, "alice", hostMeta(repository)),
    {
      repository,
      registered: true,
      auto_register_on_task_start: false,
    },
  );
});

test("opted-in trusted host directories register the canonical Git root and grant live access", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("project");
  await mkdir(join(repository, "src"));
  const alias = join(f.dir, "alias");
  await symlink(repository, alias, "dir");

  assert.equal(
    await autoRegisterChatProject(
      f.control,
      "alice",
      hostMeta(join(alias, "src")),
    ),
    repository,
  );

  assert.equal(await f.control.projects!.resolve(repository), repository);

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(repository)),
    repository,
  );

  assert.deepEqual(
    f.control
      .projects!.list()
      .map(({ repository, kind }) => ({ repository, kind })),
    [{ repository, kind: "repository" }],
  );
});

test("invalid or absent host metadata never grants access despite opt-in", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("project");
  const plainDirectory = join(f.dir, "plain-directory");
  await mkdir(plainDirectory);

  for (const meta of [
    undefined,
    {},
    { host_directory: pathToFileURL(repository).href },
    { repository },
    { "codex/sandbox-state-meta": {} },
    ...[
      null,
      3,
      "relative/path",
      repository,
      "https://example.com/project",
      "file://remote-host/project",
      "file:///nonexistent-chat-project",
      pathToFileURL(plainDirectory).href,
      "x".repeat(4097),
    ].map((sandboxCwd) => ({ "codex/sandbox-state-meta": { sandboxCwd } })),
  ]) {
    assert.equal(
      await autoRegisterChatProject(f.control, "alice", meta),
      undefined,
    );
  }

  assert.deepEqual(f.control.projects!.list(), []);

  await assert.rejects(
    f.control.projects!.resolve(repository),
    /outside allowed roots/,
  );
});

test("disabling automatic registration preserves prior approval and stops approving new chats", async (t) => {
  const f = await fixture(t);

  const prior = await f.repo("prior"),
    next = await f.repo("next");

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(prior)),
    prior,
  );

  f.enable("alice", false);

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(next)),
    undefined,
  );

  assert.equal(await f.control.projects!.resolve(prior), prior);

  await assert.rejects(
    f.control.projects!.resolve(next),
    /outside allowed roots/,
  );

  assert.deepEqual(
    f.control.projects!.list().map((project) => project.repository),
    [prior],
  );
});

test("automatic registration preserves existing parent grants", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("parent-project");
  await f.control.projects!.register(repository, "parent");
  const nested = await f.repo("parent-project/nested");

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(repository)),
    repository,
  );

  assert.equal(
    f.control
      .projects!.list()
      .find((project) => project.repository === repository)?.kind,
    "parent",
  );

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(nested)),
    nested,
  );

  assert.equal(
    f.control
      .projects!.list()
      .find((project) => project.repository === repository)?.kind,
    "parent",
  );

  assert.equal(await f.control.projects!.resolve(nested), nested);

  assert.deepEqual(
    f.control.projects!.list().map((project) => project.repository),
    [repository],
  );
});

test("missing project registry makes automatic chat registration a graceful no-op", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("project");
  f.control.projects = undefined;

  assert.equal(
    await autoRegisterChatProject(f.control, "alice", hostMeta(repository)),
    undefined,
  );
});
