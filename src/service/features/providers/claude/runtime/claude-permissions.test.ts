import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
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
import * as logging from "../../../../platform/logging/logger.js";
import {
  captureOptions,
  context,
  preToolUseHook,
  setClaudeOptions,
} from "./claude-test-harness.js";
import { PARENT_TOOL } from "./parent-tool.js";
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

  expect(options.settings).toEqual({ bashEditDiffEnabled: true });

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

  const error = new Error("recording failed");

  vi.mocked(c.fileChanged).mockImplementation(() => {
    throw error;
  });

  const log = vi.spyOn(logging, "logError").mockImplementation(() => {});

  expect(await hook(input, input.tool_use_id, { signal: c.signal })).toEqual(
    {},
  );

  expect(log).toHaveBeenCalledWith("provider.edit_capture_failed", error, {
    tool: "Write",
  });
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

  assert.equal(
    await check("Read", { file_path: join(workspace, ".git") }),
    "deny",
  );

  assert.equal(await check("Bash", { command: "pwd" }), "deny");
  assert.equal(await check("Write", { file_path: "a.ts" }), "deny");
  assert.equal(await check("Agent", {}), "deny");
  assert.equal(await check("mcp__server__tool", {}), "deny");
  assert.equal(await check(`${PARENT_TOOL}_other`, {}), "deny");
  assert.equal(await check(PARENT_TOOL, { message: "Done" }), "allow");

  c.input = async () => {
    throw new Error("Parent reporting must not request approval");
  };

  const parentReport = await options!.canUseTool!(
    PARENT_TOOL,
    { message: "Done" },
    {
      signal: c.signal,
      toolUseID: "parent-report",
      requestId: "parent-report",
    },
  );

  assert.deepEqual(parentReport, {
    behavior: "allow",
    updatedInput: { message: "Done" },
  });

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
      environment: "filtered",
      tools: "restricted",
      path_guard: true,
      subagents: false,
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

    const parentDecision = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: PARENT_TOOL,
        tool_input: { message: "Done" },
        session_id: "x",
        transcript_path: "x",
        cwd: workspace,
        tool_use_id: "parent-report",
      },
      "parent-report",
      { signal: c.signal },
    );

    assert.equal(
      (parentDecision as any).hookSpecificOutput?.permissionDecision,
      "allow",
    );

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
