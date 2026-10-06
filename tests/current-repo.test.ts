import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import type { ServerContext } from "@modelcontextprotocol/server";
import { test } from "vitest";

import { FixtureProvider } from "../dev/fixture-provider.js";
import { Control } from "../src/core/control.js";
import { startSchema, type Task } from "../src/core/model.js";
import { Store } from "../src/core/store.js";
import { Workspaces } from "../src/core/workspace.js";
import { ClaudeAgentProvider } from "../src/providers/claude.js";

async function setup() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "agent-current-repo-")),
  );

  const repo = join(dir, "repo");
  await mkdir(repo);

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

  git("init", "-q");
  await writeFile(join(repo, "tracked.txt"), "committed content\n");
  git("add", ".");

  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "initial",
  );

  const workspaces = new Workspaces(join(dir, "worktrees"), [repo]);
  const provider = new FixtureProvider();

  const c = new Control(
    new Store(join(dir, "tasks.sqlite")),
    workspaces,
    new Map([[provider.id, provider]]),
    repo,
  );

  return {
    dir,
    repo,
    git,
    workspaces,
    provider,
    c,
    close: async () => {
      await c.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function task(repository: string, revision = "HEAD"): Task {
  return {
    ...startSchema.parse({
      repository,
      revision,
      provider: "fixture",
      title: "Review edits",
      description: "Review edits",
      workspace_strategy: "current_repo",
    }),
    id: "test-task",
    title: "Review edits",
    owner: "alice",
    status: "queued",
    instructions: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    attempt: 0,
    runtime_ms: 0,
  };
}

async function dirty(repo: string, git: (...args: string[]) => string) {
  await writeFile(join(repo, "tracked.txt"), "staged content\n");
  git("add", "tracked.txt");

  await writeFile(
    join(repo, "tracked.txt"),
    "staged content\nunstaged content\n",
  );

  await writeFile(join(repo, "new file.txt"), "untracked content\n");
}

async function until(done: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Task did not complete");
}

test("current repository uses HEAD and includes staged, unstaged and untracked edits without creating a worktree", async () => {
  const s = await setup();

  try {
    await dirty(s.repo, s.git);
    const before = s.git("status", "--porcelain");
    const t = task(s.repo);
    await s.workspaces.create(t);
    assert.equal(t.workspace, s.repo);
    assert.equal(t.base_commit, s.git("rev-parse", "HEAD").trim());

    assert.equal(
      s.git("worktree", "list", "--porcelain").match(/^worktree /gm)?.length,
      1,
    );

    await assert.rejects(access(s.workspaces.root), { code: "ENOENT" });
    const diff = await s.workspaces.diff(t);
    for (const content of [
      "staged content",
      "unstaged content",
      "untracked content",
      "new file.txt",
    ])
      assert.ok(diff.includes(content), content);
    assert.equal(s.git("status", "--porcelain"), before);
  } finally {
    await s.close();
  }
});

test("current repository rejects a non-HEAD revision without altering the checkout", async () => {
  const s = await setup();

  try {
    await dirty(s.repo, s.git);
    const before = s.git("status", "--porcelain");
    const t = task(s.repo, s.git("rev-parse", "HEAD").trim());
    await assert.rejects(s.workspaces.create(t), /HEAD/);
    assert.equal(t.workspace, undefined);
    assert.equal(s.git("status", "--porcelain"), before);

    assert.equal(
      s.git("worktree", "list", "--porcelain").match(/^worktree /gm)?.length,
      1,
    );
  } finally {
    await s.close();
  }
});

test("current repository review receives the working tree diff in its provider prompt and artifact", async () => {
  const s = await setup();

  try {
    await dirty(s.repo, s.git);
    let receivedPrompt = "";

    s.provider.run = async (context, prompt) => {
      assert.equal(context.task.workspace, s.repo);
      receivedPrompt = prompt;

      return {
        summary: "Reviewed",
        findings: [],
        evidence: [],
        changes: [],
        tests: [],
        recommendations: [],
      };
    };

    const before = s.git("status", "--porcelain");

    const started = await s.c.start("alice", {
      title: "Review my uncommitted edits",
      description: "Review my uncommitted edits",
      provider: "fixture",
      workspace_strategy: "current_repo",
    });

    await until(
      () =>
        !s.c.active.has(started.id) &&
        s.c.store.get(started.id, "alice").status === "completed",
    );

    for (const content of [
      "staged content",
      "unstaged content",
      "untracked content",
    ])
      assert.ok(receivedPrompt.includes(content), content);

    const diff = s.c.store
      .artifacts(started.id, "alice")
      .find((artifact) => artifact.type === "diff");

    assert.ok(diff?.content.includes("untracked content"));
    assert.equal(s.git("status", "--porcelain"), before);

    assert.equal(
      await readFile(join(s.repo, "tracked.txt"), "utf8"),
      "staged content\nunstaged content\n",
    );
  } finally {
    await s.close();
  }
});

test("current repository settings persist, are owner-scoped, and allow task overrides", async () => {
  const s = await setup();
  s.c.stopped = true;

  try {
    assert.equal(
      s.c.settings.values("alice").default_workspace_strategy,
      "current_repo",
    );

    assert.equal(
      startSchema.parse({ title: "Review", description: "Review" })
        .workspace_strategy,
      "current_repo",
    );

    assert.equal(
      (
        await s.c.start("alice", {
          title: "Review defaults",
          description: "Review defaults",
        })
      ).workspace_strategy,
      "current_repo",
    );

    s.c.settings.update("alice", {
      set: { default_workspace_strategy: "worktree" },
    });

    assert.equal(
      s.c.settings.values("alice").default_workspace_strategy,
      "worktree",
    );

    assert.equal(
      s.c.settings.values("bob").default_workspace_strategy,
      "current_repo",
    );

    const inherited = await s.c.start("alice", {
      title: "Review",
      description: "Review",
    });

    const overridden = await s.c.start("alice", {
      title: "Implement",
      description: "Implement",
      workspace_strategy: "current_repo",
    });

    assert.equal(inherited.workspace_strategy, "worktree");
    assert.equal(overridden.workspace_strategy, "current_repo");
    const { Settings } = await import("../src/core/settings.js");

    assert.equal(
      new Settings(s.c.store, () => ["fixture"]).values("alice")
        .default_workspace_strategy,
      "worktree",
    );
  } finally {
    await s.close();
  }
});

test("task form offers current repository and submits its selected strategy", async () => {
  const s = await setup();
  s.c.stopped = true;

  try {
    const args = {
      title: "Review edits",
      description: "Review edits",
      workspace_strategy: "worktree",
    };

    const requested = (await s.c.forms.handle(
      "alice",
      "request_agent_task",
      args,
      { mcpReq: { requestState: () => undefined } } as unknown as ServerContext,
    )) as any;

    const schema = requested.inputRequests.form.params.requestedSchema;

    assert.ok(
      schema.properties.workspace_strategy.oneOf.some(
        (choice: any) => choice.const === "current_repo",
      ),
    );

    const result = await s.c.forms.handle("alice", "request_agent_task", args, {
      mcpReq: {
        requestState: () => requested.requestState,
        inputResponses: {
          form: {
            action: "accept",
            content: {
              repository: s.repo,
              description: "Review edits",
              worker: "fixture:reviewer",
              revision: "HEAD",
              workspace_strategy: "current_repo",
              max_runtime_minutes: 2,
              max_cost_usd: 1,
            },
          },
        },
      },
    } as unknown as ServerContext);

    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(s.c.store.all()[0].workspace_strategy, "current_repo");
  } finally {
    await s.close();
  }
});

test("host task form defaults current repository to HEAD and forces HEAD on submit", async () => {
  const s = await setup();
  s.c.stopped = true;

  try {
    const args = {
      title: "Review edits",
      description: "Review edits",
      revision: "feature-branch",
      workspace_strategy: "current_repo",
    };

    const requested = (await s.c.forms.handle(
      "alice",
      "request_agent_task",
      args,
      { mcpReq: { requestState: () => undefined } } as unknown as ServerContext,
    )) as any;

    const schema = requested.inputRequests.form.params.requestedSchema;
    assert.equal(schema.properties.workspace_strategy.default, "current_repo");
    assert.equal(schema.properties.revision.default, "HEAD");

    const result = await s.c.forms.handle("alice", "request_agent_task", args, {
      mcpReq: {
        requestState: () => requested.requestState,
        inputResponses: {
          form: {
            action: "accept",
            content: {
              repository: s.repo,
              description: "Review edits",
              worker: "fixture:reviewer",
              revision: "feature-branch",
              workspace_strategy: "current_repo",
              max_runtime_minutes: 2,
              max_cost_usd: 1,
            },
          },
        },
      },
    } as unknown as ServerContext);

    assert.ok(!result.isError, JSON.stringify(result));
    const task = s.c.store.all()[0];
    assert.equal(task.workspace_strategy, "current_repo");
    assert.equal(task.revision, "HEAD");
  } finally {
    await s.close();
  }
});

test("current repository write profiles edit the checkout while preserving unrelated staged and unstaged changes", async () => {
  const s = await setup();

  try {
    await writeFile(
      join(s.repo, "implementation.ts"),
      "export const value = 1;\n",
    );

    s.git("add", "implementation.ts");

    s.git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "implementation",
    );

    await dirty(s.repo, s.git);
    const staged = s.git("diff", "--cached");

    const unrelatedTracked = await readFile(
      join(s.repo, "tracked.txt"),
      "utf8",
    );

    const unrelatedNew = await readFile(join(s.repo, "new file.txt"), "utf8");

    s.provider.run = async (context) => {
      assert.equal(context.task.worker_profile, "implementer");
      assert.equal(context.task.workspace, s.repo);

      await writeFile(
        join(context.task.workspace!, "implementation.ts"),
        "export const value = 2;\n",
      );

      return {
        summary: "Implemented",
        findings: [],
        evidence: [],
        changes: ["implementation.ts"],
        tests: [],
        recommendations: [],
      };
    };

    const started = await s.c.start("alice", {
      title: "Update implementation.ts",
      description: "Update implementation.ts",
      provider: "fixture",
      worker_profile: "implementer",
      workspace_strategy: "current_repo",
    });

    await until(
      () =>
        !s.c.active.has(started.id) &&
        s.c.store.get(started.id, "alice").status === "completed",
    );

    assert.equal(
      await readFile(join(s.repo, "implementation.ts"), "utf8"),
      "export const value = 2;\n",
    );

    assert.equal(
      await readFile(join(s.repo, "tracked.txt"), "utf8"),
      unrelatedTracked,
    );

    assert.equal(
      await readFile(join(s.repo, "new file.txt"), "utf8"),
      unrelatedNew,
    );

    assert.equal(s.git("diff", "--cached"), staged);

    assert.equal(
      s.git("worktree", "list", "--porcelain").match(/^worktree /gm)?.length,
      1,
    );

    assert.ok(
      s.c.store
        .artifacts(started.id, "alice")
        .find((artifact) => artifact.type === "diff")
        ?.content.includes("+export const value = 2;"),
    );
  } finally {
    await s.close();
  }
});

test("Claude current repository reviewer runs in the checkout and its mandatory hook denies edits", async () => {
  const s = await setup();

  try {
    await dirty(s.repo, s.git);
    const status = s.git("status", "--porcelain");
    let options: Options | undefined;
    let receivedPrompt: string | AsyncIterable<any> | undefined;

    const result = {
      summary: "Reviewed",
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };

    const provider = new ClaudeAgentProvider((args) => {
      options = args.options;
      receivedPrompt = args.prompt;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            structured_output: result,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    });

    s.c.providers.set("claude", provider);

    const started = await s.c.start("alice", {
      title: "Review uncommitted changes",
      description: "Review uncommitted changes",
      provider: "claude",
      worker_profile: "reviewer",
      workspace_strategy: "current_repo",
    });

    await until(
      () =>
        !s.c.active.has(started.id) &&
        s.c.store.get(started.id, "alice").status === "completed",
    );

    assert.equal(options!.cwd, s.repo);
    assert.equal(typeof receivedPrompt, "string");
    assert.ok((receivedPrompt as string).includes("unstaged content"));
    assert.ok((receivedPrompt as string).includes("untracked content"));
    assert.ok(Array.isArray(options!.tools));
    for (const tool of ["Edit", "Write", "Bash"])
      assert.ok(!(options!.tools as string[]).includes(tool));
    const hook = options!.hooks!.PreToolUse![0].hooks[0];
    const signal = new AbortController().signal;

    for (const tool of ["Edit", "Write", "Bash"]) {
      const decision = await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: {
            file_path: join(s.repo, "tracked.txt"),
            command: "echo edit > tracked.txt",
          },
          session_id: "test",
          transcript_path: "test",
          cwd: s.repo,
          tool_use_id: tool,
        },
        tool,
        { signal },
      );

      assert.equal(
        (decision as any).hookSpecificOutput?.permissionDecision,
        "deny",
        tool,
      );
    }

    const read = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: join(s.repo, "tracked.txt") },
        session_id: "test",
        transcript_path: "test",
        cwd: s.repo,
        tool_use_id: "Read",
      },
      "Read",
      { signal },
    );

    assert.equal(
      (read as any).hookSpecificOutput?.permissionDecision,
      undefined,
    );

    assert.equal(s.git("status", "--porcelain"), status);
  } finally {
    await s.close();
  }
});
