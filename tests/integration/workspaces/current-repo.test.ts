import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Options,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { structuredPatch } from "diff";
import { test } from "vitest";

import { fixtureProvider } from "../../../dev/service/fixture-provider-test-helpers.js";
import { ClaudeAgentProvider } from "../../../src/service/features/providers/claude/runtime/provider.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { startSchema, type Task } from "../../../src/shared/tasks/model.js";
import { readyClaudeCli } from "../../support/claude-cli.js";

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
  const provider = fixtureProvider();

  const c = new Control(
    new Store(join(dir, "tasks.sqlite")),
    workspaces,
    new Map([[provider.id, provider]]),
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
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 0,
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

test("current repository review receives the working tree diff in its provider prompt", async () => {
  const s = await setup();

  try {
    await dirty(s.repo, s.git);
    let receivedPrompt = "";

    s.provider.run = async (context, prompt) => {
      assert.equal(context.task.workspace, s.repo);
      receivedPrompt = prompt;

      return {
        reply: "Reviewed",
      };
    };

    const before = s.git("status", "--porcelain");

    const started = await s.c.start("alice", {
      repository: s.repo,
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
    ]) {
      assert.ok(receivedPrompt.includes(content), content);
    }

    const completed = s.c.store.get(started.id, "alice");
    assert.equal(completed.workspace, s.repo);
    assert.equal(completed.base_commit, s.git("rev-parse", "HEAD").trim());

    assert.equal(
      s.git("worktree", "list", "--porcelain").match(/^worktree /gm)?.length,
      1,
    );

    // The task's own changes leave out the user's earlier edits.
    const changes = s.c.changes.changes(completed);

    assert.deepEqual(changes.files, []);
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
      s.c.settings.values("alice").task.workspace_strategy,
      "current_repo",
    );

    assert.equal(
      startSchema.parse({ repository: "/repo", description: "Review" })
        .workspace_strategy,
      "current_repo",
    );

    assert.equal(
      (
        await s.c.start("alice", {
          repository: s.repo,
          title: "Review defaults",
          description: "Review defaults",
        })
      ).workspace_strategy,
      "current_repo",
    );

    s.c.settings.update("alice", {
      set: { task: { workspace_strategy: "worktree" } },
    });

    assert.equal(
      s.c.settings.values("alice").task.workspace_strategy,
      "worktree",
    );

    assert.equal(
      s.c.settings.values("bob").task.workspace_strategy,
      "current_repo",
    );

    const inherited = await s.c.start("alice", {
      repository: s.repo,
      title: "Review",
      description: "Review",
    });

    const overridden = await s.c.start("alice", {
      repository: s.repo,
      title: "Implement",
      description: "Implement",
      workspace_strategy: "current_repo",
    });

    assert.equal(inherited.workspace_strategy, "worktree");
    assert.equal(overridden.workspace_strategy, "current_repo");

    const { Settings } =
      await import("../../../src/service/features/settings/settings.js");

    assert.equal(
      new Settings(s.c.store.database, () => ["fixture"]).values("alice").task
        .workspace_strategy,
      "worktree",
    );
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
        join(context.task.workspace, "implementation.ts"),
        "export const value = 2;\n",
      );

      context.fileChanged({
        path: join(context.task.workspace, "implementation.ts"),
        hunks: structuredPatch(
          "",
          "",
          "export const value = 1;\n",
          "export const value = 2;\n",
        ).hunks,
        source: "tool",
      });

      return {
        reply: "Implemented",
      };
    };

    const started = await s.c.start("alice", {
      repository: s.repo,
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

    // Only the worker's edit is the task's change, not the unrelated ones.
    const changes = s.c.changes.changes(s.c.store.get(started.id, "alice"));

    assert.deepEqual(
      changes.files.map((file) => file.path),
      ["implementation.ts"],
    );

    assert.ok(changes.diff.includes("+export const value = 2;"));
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
    let receivedPrompt: unknown;

    const provider = new ClaudeAgentProvider(
      (args) => {
        options = args.options;
        const prompt = args.prompt as AsyncIterable<SDKUserMessage>;

        return Object.assign(
          (async function* () {
            // The turn's prompt is the first message of its input stream.
            const first = await prompt[Symbol.asyncIterator]().next();
            receivedPrompt = (first.value as SDKUserMessage).message.content;

            yield {
              type: "result",
              subtype: "success",
              result: "Reviewed",
              total_cost_usd: 0,
              usage: {},
            };
          })(),
          { close: () => {} },
        ) as unknown as Query;
      },
      undefined,
      readyClaudeCli,
    );

    s.c.providers.set("claude", provider);

    const started = await s.c.start("alice", {
      repository: s.repo,
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

    for (const tool of ["Edit", "Write", "Bash"]) {
      assert.ok(!options!.tools.includes(tool));
    }

    const [matcher] = options!.hooks!.PreToolUse!;

    assert.ok(matcher);
    const [hook] = matcher.hooks;
    assert.ok(hook);
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
