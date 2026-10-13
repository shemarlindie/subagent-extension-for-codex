import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { FixtureProvider } from "./fixture-provider.js";
import { context, task } from "./fixture-provider-test-helpers.js";

test("fixture tool and content scenarios produce representative synthetic events", async () => {
  const provider = new FixtureProvider();
  const f = context();

  const prompt = [
    "[fixture:tool name=Read]",
    "[fixture:tool-error name=Bash]",
    "[fixture:content role=user type=text]",
    "[fixture:content type=text role=assistant]",
    "[fixture:content type=thinking]",
    "[fixture:content type=tool_use outcome=success name=Read]",
    "[fixture:content type=tool_use outcome=error name=Bash]",
    "[fixture:content type=tool_use outcome=running name=Read]",
    "[fixture:content type=tool_result outcome=success]",
    "[fixture:content type=tool_result outcome=error]",
    "[fixture:content type=image source.type=base64 source.media_type=image/png source.data=ZmFrZQ==]",
    "[fixture:content type=document]",
    "[fixture:content type=redacted_thinking]",
    "[fixture:content type=empty]",
    "[fixture:content type=error role=user]",
    "[fixture:content type=custom_block]",
  ].join(" ");

  await provider.run(f.runContext, prompt);

  const completedToolIds = new Set(
    f.events
      .filter((event) => event.type === "tool.completed")
      .map((event) => event.data.id),
  );

  const runningTool = f.events.find((event) => {
    const input = event.data.input as { file_path?: string } | undefined;

    return (
      event.type === "tool.started" &&
      input?.file_path === "fixture/content-tool.txt" &&
      !completedToolIds.has(event.data.id)
    );
  });

  assert.ok(runningTool);

  assert.ok(
    f.events.some(
      (event) => event.type === "tool.completed" && event.data.error === true,
    ),
  );

  assert.ok(
    f.events.some(
      (event) =>
        event.type === "agent.content" &&
        event.data.role === "user" &&
        event.data.content === "Fixture content event for activity rendering.",
    ),
  );

  assert.ok(
    f.events.some(
      (event) =>
        event.type === "agent.content" &&
        Array.isArray(event.data.content) &&
        event.data.content.length === 0,
    ),
  );

  const contentBlocks = f.events
    .filter((event) => event.type === "agent.content")
    .map((event) => event.data.content)
    .filter(
      (content): content is Record<string, unknown> =>
        !!content && typeof content === "object" && !Array.isArray(content),
    );

  const image = contentBlocks.find((content) => content.type === "image");

  assert.deepEqual(image?.source, {
    type: "base64",
    media_type: "image/png",
    data: "ZmFrZQ==",
  });

  assert.ok(contentBlocks.some((content) => content.type === "document"));

  assert.ok(
    contentBlocks.some((content) => content.type === "redacted_thinking"),
  );

  assert.ok(contentBlocks.some((content) => content.type === "custom_block"));
});

test("fixture restrictions and child workers follow configured policy", async () => {
  const provider = new FixtureProvider();
  const f = context();

  const restrictions = [
    "sandbox",
    "environment",
    "tools",
    "path_guard",
    "subagents",
  ];

  await provider.run(
    f.runContext,
    [
      ...restrictions.map((name) => `[fixture:restriction name=${name}]`),
      "[fixture:subagent count=2 outcome=error]",
    ].join(" "),
  );

  for (const name of restrictions) {
    assert.ok(
      f.events.some(
        (event) =>
          event.type === "claude.activity" &&
          event.data.type === "permission_denied" &&
          event.data.tool_name === name,
      ),
      name,
    );
  }

  assert.equal(
    f.events.filter(
      (event) =>
        event.type === "agent.completed" && event.data.agent_id !== undefined,
    ).length,
    2,
  );

  const blocked = context(task("task_blocked_subagents"));

  blocked.runContext.task.provider_options = {
    fixture: {
      claude_policy: {
        sandbox: "extension",
        environment: "filtered",
        tools: "restricted",
        path_guard: true,
        subagents: false,
      },
    },
  };

  await provider.run(blocked.runContext, "[fixture:subagent]");

  assert.ok(
    blocked.events.some(
      (event) =>
        event.type === "claude.activity" &&
        event.data.type === "permission_denied" &&
        event.data.tool_name === "Agent",
    ),
  );
});

test("fixture change scenarios write only into isolated worktrees", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "fixture-provider-worktree-"));

  try {
    const f = context();
    f.runContext.task.workspace = workspace;
    f.runContext.task.workspace_strategy = "worktree";

    await new FixtureProvider().run(f.runContext, "[fixture:change]");

    const file = `fixture-scenario-${f.runContext.task.id}-turn-${f.runContext.task.turn}.md`;

    assert.match(
      await readFile(join(workspace, file), "utf8"),
      /# Fixture change/,
    );

    assert.ok(
      f.events.some(
        (event) =>
          event.type === "claude.activity" &&
          event.data.type === "files_persisted",
      ),
    );

    const unsafe = context(task("task_current_repo_change"));
    unsafe.runContext.task.workspace = workspace;
    unsafe.runContext.task.workspace_strategy = "current_repo";

    await assert.rejects(
      new FixtureProvider().run(unsafe.runContext, "[fixture:change]"),
      /require an isolated worktree task/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
