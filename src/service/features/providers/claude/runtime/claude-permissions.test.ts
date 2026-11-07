import assert from "node:assert/strict";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Options } from "@anthropic-ai/claude-agent-sdk";
import { expect, test, vi } from "vitest";

import {
  fakeClaudePath,
  readyClaudeCli,
} from "../../../../../../tests/support/claude-cli.js";
import {
  claudeOverrideDefaults,
  resolveClaudePolicy,
} from "../../../../../shared/providers/claude/permissions.js";
import { adminTokenRule } from "../configuration/admin-token.js";
import { claudeTaskPolicy } from "../configuration/task-policy.js";
import {
  captureOptions,
  context,
  preToolUseHook,
  setClaudeOptions,
} from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";
import { claudeTurnOptions } from "./turn-options.js";

test("M6 PostToolUse records subagent edits and returns an empty result after recorder failures", async () => {
  const { c, workspace } = await context();

  const options = await claudeTurnOptions(
    c,
    fakeClaudePath,
    new AbortController(),
  );

  const hook = options.hooks?.PostToolUse?.[0]?.hooks[0];
  assert.ok(hook, "PostToolUse hook is registered");

  const input = {
    hook_event_name: "PostToolUse" as const,
    tool_name: "Write",
    tool_input: { file_path: join(workspace, "sub.txt"), content: "sub\n" },
    tool_response: {
      type: "create",
      filePath: join(workspace, "sub.txt"),
      content: "sub\n",
      originalFile: null,
      structuredPatch: [],
    },
    session_id: "session-test",
    transcript_path: "transcript-test",
    cwd: workspace,
    tool_use_id: "subagent-write",
    agent_id: "child-agent",
  };

  expect(options.settings).toMatchObject({ bashEditDiffEnabled: true });

  expect(await hook(input, input.tool_use_id, { signal: c.signal })).toEqual(
    {},
  );

  expect(c.fileChanged).toHaveBeenCalledWith(
    expect.objectContaining({
      path: join(workspace, "sub.txt"),
      created: true,
      source: "tool",
    }),
  );

  vi.mocked(c.fileChanged).mockImplementation(() => {
    throw new Error("recording failed");
  });

  expect(await hook(input, input.tool_use_id, { signal: c.signal })).toEqual(
    {},
  );
});

test("every task denies the admin token, and its hook denies file tools on it", async () => {
  const { c } = await context();
  const data = await realpath(process.env.SUBAGENT_EXTENSION_FOR_CODEX_DATA!);
  const token = join(data, "admin-token");
  await writeFile(token, "token");
  // Worktrees live in the data directory.
  const workspace = join(data, "worktrees", "task-test");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "own.txt"), "own");
  await symlink(token, join(workspace, "link"));
  c.task.workspace = workspace;
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    permission_mode: "default",
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  const options = await claudeTurnOptions(
    c,
    fakeClaudePath,
    new AbortController(),
  );

  expect(options.settings).toMatchObject({
    permissions: { deny: [`Read(/${token})`] },
  });

  assert.equal(
    adminTokenRule("C:\\data\\admin-token"),
    "Read(//c/data/admin-token)",
  );

  const hook = preToolUseHook(options);

  const decision = async (tool: string, input: object) =>
    (
      (await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: input,
          session_id: "x",
          transcript_path: "x",
          cwd: workspace,
          tool_use_id: "x",
        },
        "x",
        { signal: c.signal },
      )) as any
    ).hookSpecificOutput?.permissionDecision;

  assert.equal(await decision("Read", { file_path: token }), "deny");
  assert.equal(await decision("Read", { file_path: "link" }), "deny");
  assert.equal(await decision("Write", { file_path: token }), "deny");
  assert.equal(await decision("Grep", { pattern: "x", path: data }), "deny");
  assert.equal(await decision("Glob", { pattern: "*", path: data }), "deny");
  assert.equal(await decision("Read", { file_path: "own.txt" }), undefined);
  assert.equal(await decision("Edit", { file_path: "own.txt" }), undefined);
  assert.equal(await decision("Grep", { pattern: "x" }), undefined);
});

test("PostToolUse flags a command in a task whose folder has no Git", async () => {
  const { c, workspace } = await context();
  c.task.no_git = true;

  const options = await claudeTurnOptions(
    c,
    fakeClaudePath,
    new AbortController(),
  );

  await options.hooks?.PostToolUse?.[0]?.hooks[0]?.(
    {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { stdout: "" },
      session_id: "session-test",
      transcript_path: "transcript-test",
      cwd: workspace,
      tool_use_id: "bash",
    },
    "bash",
    { signal: c.signal },
  );

  expect(c.editUnrecorded).toHaveBeenCalledWith(undefined, "command");
});

test("Claude read-only profile bundle denies outside paths, symlink escapes, Git metadata and disallowed tools", async () => {
  const { c, workspace } = await context();
  await symlink(tmpdir(), join(workspace, "escape"));
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => {
      options = value;
    }),
    undefined,
    readyClaudeCli,
  );

  await provider.run(c, "Review");
  const hook = preToolUseHook(options);

  const check = async (tool: string, input: object) => {
    const r = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
        session_id: "x",
        transcript_path: "x",
        cwd: workspace,
        tool_use_id: "x",
      },
      "x",
      { signal: c.signal },
    );

    return (r as any).hookSpecificOutput?.permissionDecision;
  };

  assert.equal(
    await check("Read", { file_path: join(tmpdir(), "secret") }),
    "deny",
  );

  assert.equal(
    await check("Read", { file_path: join(workspace, "escape", "secret") }),
    "deny",
  );

  await mkdir(join(workspace, "vendor/.git"), { recursive: true });

  assert.equal(
    await check("Read", { file_path: join(workspace, "vendor/.git/config") }),
    "deny",
  );

  assert.equal(
    await check("Read", { file_path: join(workspace, ".git") }),
    "deny",
  );

  assert.equal(await check("Bash", { command: "pwd" }), "deny");
  assert.equal(await check("Write", { file_path: "a.ts" }), "deny");
  assert.equal(await check("Agent", {}), "deny");
  assert.equal(await check("mcp__server__tool", {}), "deny");
  assert.equal(await check("Skill", { skill: "review" }), undefined);
  assert.equal(await check("Read", { file_path: "a.ts" }), undefined);
});

test("write-profile shell commands require human decision and cannot use edited approval payloads", async () => {
  const { c } = await context();
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  setClaudeOptions(c.task, { permission_mode: "default" });
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => {
      options = value;
    }),
    undefined,
    readyClaudeCli,
  );

  await provider.run(c, "Implement");
  const command = { command: "npm test" };

  const denied = await options!.canUseTool!("Bash", command, {
    signal: c.signal,
    toolUseID: "tool",
    requestId: "request",
  });

  assert.equal(denied!.behavior, "deny");

  c.input = async () => ({
    approved: true,
    input: { command: "other command" },
  });

  const approved = await options!.canUseTool!("Bash", command, {
    signal: c.signal,
    toolUseID: "tool",
    requestId: "request",
  });

  assert.equal(approved!.behavior, "allow");
  assert.deepEqual((approved as any).updatedInput, command);
  // MCP tools follow the same approval routing as shell commands.
  const tool = { query: "status" };

  const mcp = await options!.canUseTool!("mcp__server__tool", tool, {
    signal: c.signal,
    toolUseID: "tool",
    requestId: "request",
  });

  assert.equal(mcp!.behavior, "allow");
  assert.deepEqual((mcp as any).updatedInput, tool);
});

test("Claude forwards each native permission mode and reserves bypass opt-in for bypassPermissions", async () => {
  const { c, workspace } = await context();
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  // Restrictions enabled in settings apply in every native mode.
  setClaudeOptions(c.task, {
    claude_policy: {
      sandbox: "extension",
      tools: "restricted",
      path_guard: true,
      subagents: false,
      settings_files: true,
      user_mcp: true,
    },
  });

  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => {
      options = value;
    }),
    undefined,
    readyClaudeCli,
  );

  for (const mode of [
    "default",
    "acceptEdits",
    "plan",
    "dontAsk",
    "auto",
    "bypassPermissions",
  ] as const) {
    setClaudeOptions(c.task, { permission_mode: mode });
    await provider.run(c, "Implement");
    assert.equal(options!.permissionMode, mode);

    assert.equal(
      options!.allowDangerouslySkipPermissions,
      mode === "bypassPermissions" ? true : undefined,
    );

    const hook = preToolUseHook(options);

    assert.equal(options!.allowedTools, undefined);

    const decision = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "pwd" },
        session_id: "x",
        transcript_path: "x",
        cwd: workspace,
        tool_use_id: "x",
      },
      "x",
      { signal: c.signal },
    );

    assert.equal(
      (decision as any).hookSpecificOutput?.permissionDecision,
      mode === "plan" ? "deny" : undefined,
    );

    const outside = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: join(tmpdir(), "forbidden") },
        session_id: "x",
        transcript_path: "x",
        cwd: workspace,
        tool_use_id: "x",
      },
      "x",
      { signal: c.signal },
    );

    assert.equal(
      (outside as any).hookSpecificOutput?.permissionDecision,
      "deny",
    );
  }

  c.task.worker_profile = "reviewer";
  setClaudeOptions(c.task, { permission_mode: "bypassPermissions" });
  await provider.run(c, "Review");

  assert.ok(
    options!.tools instanceof Array &&
      !options!.tools.includes("Write") &&
      !options!.tools.includes("Bash"),
  );

  assert.equal(
    (await options!.canUseTool!(
      "Write",
      { file_path: "a.ts" },
      { signal: c.signal, toolUseID: "write", requestId: "request" },
    ))!.behavior,
    "deny",
  );
});

test("unresolved SDK edits ask the configured decision maker and preserve the original input", async () => {
  const { c } = await context();
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  setClaudeOptions(c.task, { permission_mode: "default" });
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => {
      options = value;
    }),
    undefined,
    readyClaudeCli,
  );

  await provider.run(c, "Implement");

  for (const tool of ["Edit", "Write"]) {
    const input = { file_path: "a.ts", content: "approved contents" };

    assert.equal(
      (await options!.canUseTool!(tool, input, {
        signal: c.signal,
        toolUseID: "edit",
        requestId: "request",
      }))!.behavior,
      "deny",
    );

    let requested: unknown;

    c.input = async (name, payload) => {
      requested = { name, payload };

      return {
        approved: true,
        input: { file_path: "/tmp/another-file", content: "substitution" },
      };
    };

    const allowed = await options!.canUseTool!(tool, input, {
      signal: c.signal,
      toolUseID: "edit",
      requestId: "request",
    });

    assert.deepEqual(requested, { name: tool, payload: input });
    assert.equal(allowed!.behavior, "allow");
    assert.deepEqual((allowed as any).updatedInput, input);
    c.input = async () => ({ approved: false });
  }
});

test("only Claude's own question tool takes answers; other requests stay permissions", async () => {
  for (const tool of [
    "Bash",
    "Edit",
    "mcp__server__AskUserQuestion",
    "Skill",
  ]) {
    assert.equal(claudeTaskPolicy.inputKind(tool), "permission");
  }

  assert.equal(claudeTaskPolicy.inputKind("AskUserQuestion"), "question");

  const { c } = await context();
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => {
      options = value;
    }),
    undefined,
    readyClaudeCli,
  );

  await provider.run(c, "Ask");
  const question = { questions: [{ question: "Which approach?" }] };

  c.input = async () => ({
    approved: true,
    input: { answers: { "Which approach?": "The first" } },
  });

  const answered = await options!.canUseTool!("AskUserQuestion", question, {
    signal: c.signal,
    toolUseID: "question",
    requestId: "request",
  });

  assert.equal(answered!.behavior, "allow");

  assert.deepEqual((answered as any).updatedInput, {
    ...question,
    answers: { "Which approach?": "The first" },
  });
});
