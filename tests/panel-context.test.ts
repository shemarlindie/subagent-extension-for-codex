import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Control } from "../src/control.js";
import { Store } from "../src/store.js";
import { Workspaces } from "../src/workspace.js";
import { Projects } from "../src/projects.js";
import { startSchema, type Task } from "../src/model.js";
import { resolvePanelContext, taskPanelContext } from "../src/panel-context.js";
import { withHostRepository } from "../src/host-context.js";
import { withConversation } from "../src/tools.js";

async function fixture(t: TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "panel-context-")));
  const store = new Store(join(dir, "test.sqlite"));
  const workspaces = new Workspaces(join(dir, "worktrees"), []);
  const c = new Control(store, workspaces, new Map(), dir);
  c.projects = new Projects(store, workspaces);
  t.after(async () => {
    await c.close();
    await rm(dir, { recursive: true, force: true });
  });
  const repo = async (name: string, approved = true) => {
    const path = join(dir, name);
    await mkdir(path, { recursive: true });
    execFileSync("git", ["init", "-q", path]);
    if (approved) await c.projects!.register(path);
    return path;
  };
  const seed = (
    id: string,
    repository: string,
    overrides: Partial<Task> = {},
  ) => {
    const task: Task = {
      ...startSchema.parse({ task: "Review", repository }),
      id,
      owner: "alice",
      status: "running",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      instructions: [],
      attempt: 0,
      runtime_ms: 0,
      ...overrides,
    };
    store.save(task);
    return task;
  };
  return { dir, c, repo, seed };
}

test("panel defaults use only the latest owned task in the same conversation", async (t) => {
  const f = await fixture(t);
  const a = await f.repo("a"),
    b = await f.repo("b");
  f.seed("old", a, {
    conversation_id: "chat-a",
    revision: "old",
    created_at: "2026-01-01",
  });
  f.seed("latest", a, {
    conversation_id: "chat-a",
    revision: "feature",
    created_at: "2026-01-02",
  });
  f.seed("other-chat", b, {
    conversation_id: "chat-b",
    created_at: "2026-01-03",
  });
  f.seed("other-owner", b, {
    owner: "bob",
    conversation_id: "chat-a",
    created_at: "2026-01-04",
  });
  assert.deepEqual(
    await resolvePanelContext(f.c, "alice", { conversation_id: "chat-a" }),
    {
      panel_scope: {
        conversation_id: "chat-a",
        repository: a,
        revision: "feature",
      },
    },
  );
  for (const args of [
    {},
    { conversation_id: null },
    { conversation_id: "new-chat" },
  ]) {
    assert.deepEqual(await resolvePanelContext(f.c, "alice", args), {
      panel_scope: { conversation_id: args.conversation_id ?? null },
    });
  }
  assert.deepEqual(
    await resolvePanelContext(f.c, "alice", {
      conversation_id: "chat-a",
      repository: b,
    }),
    {
      panel_scope: {
        conversation_id: "chat-a",
        repository: b,
        revision: "HEAD",
      },
    },
  );
  assert.deepEqual(
    await resolvePanelContext(f.c, "alice", {
      conversation_id: "chat-a",
      repository: b,
      revision: "custom",
    }),
    {
      panel_scope: {
        conversation_id: "chat-a",
        repository: b,
        revision: "custom",
      },
    },
  );
});

test("an unavailable history default does not prevent choosing a different project", async (t) => {
  const f = await fixture(t);
  const old = await f.repo("removed"),
    active = await f.repo("active");
  f.seed("old-task", old, { conversation_id: "chat-a" });
  f.c.store.db.prepare("DELETE FROM project_roots WHERE path=?").run(old);
  assert.deepEqual(
    await resolvePanelContext(f.c, "alice", { conversation_id: "chat-a" }),
    {
      panel_scope: { conversation_id: "chat-a" },
    },
  );
  assert.equal(
    (
      await resolvePanelContext(f.c, "alice", {
        conversation_id: "chat-a",
        repository: active,
      })
    ).panel_scope.repository,
    active,
  );
  await assert.rejects(
    resolvePanelContext(f.c, "alice", { repository: old }),
    /outside allowed roots/,
  );
  await assert.rejects(
    resolvePanelContext(f.c, "alice", { task_id: "old-task" }),
    /outside allowed roots/,
  );
});

test("task selection checks ownership and rejects conflicting scope", async (t) => {
  const f = await fixture(t);
  const a = await f.repo("a"),
    b = await f.repo("b");
  const selected = f.seed("selected", a, {
    conversation_id: "chat-a",
    revision: "feature",
  });
  f.seed("private", a, { owner: "bob" });
  await assert.rejects(
    resolvePanelContext(f.c, "alice", { task_id: "private" }),
    /Task not found/,
  );
  await assert.rejects(
    resolvePanelContext(f.c, "alice", {
      task_id: "selected",
      conversation_id: "chat-b",
    }),
    /different conversation/,
  );
  await assert.rejects(
    resolvePanelContext(f.c, "alice", { task_id: "selected", repository: b }),
    /different repository/,
  );
  await assert.rejects(
    resolvePanelContext(f.c, "alice", {
      task_id: "selected",
      revision: "HEAD",
    }),
    /different revision/,
  );
  assert.deepEqual(
    await resolvePanelContext(f.c, "alice", { task_id: "selected" }),
    taskPanelContext(selected),
  );
  selected.result = {
    summary: "Done",
    findings: [],
    evidence: [],
    changes: [],
    tests: [],
    recommendations: [],
  };
  f.c.store.save(selected);
  assert.equal(
    (await resolvePanelContext(f.c, "alice", { task_id: selected.id }))
      .panel_selection?.tab,
    "result",
  );
  assert.equal(
    taskPanelContext(selected).panel_selection.tab,
    "activity",
    "a newly started task always activates Activity",
  );
  const alias = join(f.dir, "alias");
  await symlink(a, alias, "dir");
  assert.equal(
    (
      await resolvePanelContext(f.c, "alice", {
        task_id: selected.id,
        repository: alias,
      })
    ).panel_scope.repository,
    a,
  );
});

test("sandbox directory hints resolve approved Git roots without granting access", async (t) => {
  const f = await fixture(t);
  const a = await f.repo("approved repo"),
    b = await f.repo("unapproved", false);
  await mkdir(join(a, "src"));
  const alias = join(f.dir, "alias");
  await symlink(a, alias, "dir");
  const meta = {
    "codex/sandbox-state-meta": {
      sandboxCwd: pathToFileURL(join(alias, "src")).href,
      sandboxPolicy: { type: "danger-full-access" },
    },
  };
  assert.equal((await withHostRepository(f.c, {}, meta)).repository, a);
  assert.deepEqual(
    await resolvePanelContext(f.c, "alice", {
      host_directory: pathToFileURL(join(a, "src")).href,
    }),
    {
      panel_scope: { conversation_id: null, repository: a, revision: "HEAD" },
    },
  );
  for (const sandboxCwd of [
    pathToFileURL(b).href,
    "file://remote-host/repo",
    "https://host/repo",
    a,
    "relative/path",
    "file:///nonexistent",
    "x".repeat(4097),
  ]) {
    assert.deepEqual(
      await withHostRepository(
        f.c,
        {},
        { "codex/sandbox-state-meta": { sandboxCwd } },
      ),
      {},
      sandboxCwd,
    );
  }
  assert.deepEqual(
    f.c.projects!.list().map((p) => p.repository),
    [a],
  );
  const explicit = { repository: b };
  assert.deepEqual(await withHostRepository(f.c, explicit, meta), explicit);
  const selection = { task_id: "selected" };
  assert.deepEqual(await withHostRepository(f.c, selection, meta), selection);
  f.seed("fallback", a, { conversation_id: "chat-a", revision: "feature" });
  assert.deepEqual(
    await resolvePanelContext(f.c, "alice", {
      conversation_id: "chat-a",
      host_directory: pathToFileURL(b).href,
    }),
    {
      panel_scope: {
        conversation_id: "chat-a",
        repository: a,
        revision: "feature",
      },
    },
  );
});

test("host correlation honors explicit values and isolates supported tools", () => {
  const meta = {
    "openai/session": "session",
    threadId: "thread",
    "codex/sandbox-state-meta": { sandboxCwd: "file:///project" },
  };
  for (const name of [
    "start_agent_task",
    "list_agent_tasks",
    "open_codex_subagent_extension",
    "get_agent_panel_context",
  ]) {
    assert.equal(withConversation(name, {}, meta).conversation_id, "session");
    assert.equal(
      withConversation(name, {}, { threadId: "thread" }).conversation_id,
      "thread",
    );
    for (const conversation_id of ["explicit", null]) {
      assert.equal(
        withConversation(name, { conversation_id }, meta).conversation_id,
        conversation_id,
      );
    }
  }
  for (const value of ["", "   ", "x".repeat(257), 7, null]) {
    assert.equal(
      withConversation("list_agent_tasks", {}, { "openai/session": value })
        .conversation_id,
      undefined,
    );
  }
  assert.deepEqual(
    withConversation("get_agent_task", { task_id: "owned" }, meta),
    { task_id: "owned" },
  );
  assert.equal(
    withConversation("start_agent_task", {}, meta).host_directory,
    undefined,
  );
  for (const name of [
    "open_codex_subagent_extension",
    "get_agent_panel_context",
  ]) {
    assert.deepEqual(withConversation(name, { conversation_id: null }, meta), {
      conversation_id: null,
    });
    assert.equal(
      withConversation(name, {}, meta).host_directory,
      "file:///project",
    );
    assert.equal(
      withConversation(name, { host_directory: "file:///explicit" }, meta)
        .host_directory,
      "file:///explicit",
    );
  }
});

test("explicit task panels ignore ambient chat and directory but reject explicit conflicts", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("task-repo");
  const meta = {
    "openai/session": "ambient-chat",
    "codex/sandbox-state-meta": { sandboxCwd: "file:///unrelated-project" },
  };
  for (const selected of [
    f.seed("legacy", repository),
    f.seed("another-chat", repository, { conversation_id: "task-chat" }),
  ]) {
    for (const name of [
      "open_codex_subagent_extension",
      "get_agent_panel_context",
    ]) {
      const args = withConversation(name, { task_id: selected.id }, meta);
      assert.deepEqual(args, { task_id: selected.id });
      assert.deepEqual(
        await resolvePanelContext(f.c, "alice", args),
        taskPanelContext(selected),
      );
      await assert.rejects(
        resolvePanelContext(
          f.c,
          "alice",
          withConversation(
            name,
            {
              task_id: selected.id,
              conversation_id: "explicit-conflict",
            },
            meta,
          ),
        ),
        /different conversation/,
      );
    }
  }
});
