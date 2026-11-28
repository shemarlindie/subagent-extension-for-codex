import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Options,
  type Query,
  type SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import { onTestFinished, vi } from "vitest";

import { readyClaudeCli } from "../../../../../tests/support/claude-cli.js";
import { type RunContext } from "../../../../core/service/features/providers/types.js";
import { startSchema, type Task } from "../../../../core/shared/tasks/model.js";
import { now } from "../../../../core/shared/time.js";
import {
  claudeOverrideDefaults,
  resolveClaudePolicy,
  type ClaudePolicy,
} from "../../shared/permissions.js";
import { ClaudeAgentProvider } from "./provider.js";

export const reply = "Reviewed: a.ts:1 is missing a check.";

export const setClaudeOptions = (
  task: Task,
  patch: Record<string, unknown>,
) => {
  task.provider_options = {
    ...task.provider_options,
    claude: { ...task.provider_options?.claude, ...patch },
  };
};

export const claudeOptions = (task: Task) =>
  task.provider_options?.claude ?? {};

/** What `getContextUsage` answers, with the fields the provider reads. */
export const contextUsage = (totalTokens: number) =>
  ({
    totalTokens,
    rawMaxTokens: 200_000,
    isAutoCompactEnabled: true,
    autoCompactThreshold: 167_000,
    categories: [
      { name: "System prompt", tokens: 3_000, kind: "used" },
      { name: "Messages", tokens: totalTokens - 3_000, kind: "used" },
      { name: "Free space", tokens: 200_000 - totalTokens, kind: "free" },
    ],
  }) as unknown as SDKControlGetContextUsageResponse;

// The first PreToolUse hook callback the provider registered.
export function preToolUseHook(options: Options | undefined) {
  const hook = options?.hooks?.PreToolUse?.[0]?.hooks[0];
  assert.ok(hook, "PreToolUse hook is registered");

  return hook;
}

export async function context() {
  const workspace = await mkdtemp(join(tmpdir(), "claude-contract-"));
  onTestFinished(() => rm(workspace, { recursive: true, force: true }));
  // The extension sandbox resolves the data directory, which the service creates at startup.
  const data = await mkdtemp(join(tmpdir(), "claude-contract-data-"));
  onTestFinished(() => rm(data, { recursive: true, force: true }));
  vi.stubEnv("SUBAGENT_EXTENSION_FOR_CODEX_DATA", data);
  execFileSync("git", ["init", "-q", workspace]);
  await writeFile(join(workspace, "a.ts"), "test");

  const task: Task = {
    ...startSchema.parse({
      repository: "/repo",
      description: "Review",
      worker_profile: "reviewer",
      provider_options: {
        claude: { permission_mode: "plan", approval_decider: "user" },
      },
    }),
    repository: workspace,
    id: "task-test",
    title: "Review",
    owner: "alice",
    status: "running",
    created_at: now(),
    updated_at: now(),
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
    provider_options: {
      claude: {
        permission_mode: "plan",
        approval_decider: "user",
        permission_source: "task",
        claude_policy: resolveClaudePolicy(claudeOverrideDefaults),
      },
    },
    workspace,
    cost_usd: 1,
    session_id: "existing-session",
  };

  const events: any[] = [];
  const sessions: any[] = [];

  const c: RunContext = {
    fileChanged: vi.fn(),
    editUnrecorded: vi.fn(),
    task,
    signal: new AbortController().signal,
    emit: (type, data) => events.push({ type, data }),
    emitOpaque: (type, data) => events.push({ type, data }),
    session: (id, ref) => sessions.push({ id, ref }),
    sessionOption: (key, value) => setClaudeOptions(task, { [key]: value }),
    promptHeld: () => {},
    input: async () => ({ approved: false, message: "User declined" }),
    acceptSteers: () => {},
    steerTaken: () => {},
    planUpdated: (steps, changed) => {
      if (steps.length) {
        task.plan = { steps };
      } else {
        delete task.plan;
      }

      events.push({ type: "agent.plan", data: { steps, changed } });
    },
    visualShown: vi.fn(() => 1),
    wrappedUp: vi.fn(),
    delta: () => {},
  };

  return { c, events, sessions, workspace, data };
}

export async function runWithPolicy(
  policy: ClaudePolicy,
  worker_profile: Task["worker_profile"] = "implementer",
) {
  const ctx = await context();
  ctx.c.task.worker_profile = worker_profile;
  setClaudeOptions(ctx.c.task, { permission_mode: "default" });
  setClaudeOptions(ctx.c.task, { claude_policy: policy });
  const asked: string[] = [];

  ctx.c.input = async (tool) => {
    asked.push(tool);

    return { approved: true };
  };

  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => {
      options = value;
    }),
    readyClaudeCli,
  );

  await provider.run(ctx.c, "Work");
  assert.ok(options);
  const hook = preToolUseHook(options);

  const check = async (tool: string, input: object) =>
    (
      (await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: input,
          session_id: "x",
          transcript_path: "x",
          cwd: ctx.workspace,
          tool_use_id: "x",
        },
        "x",
        { signal: ctx.c.signal },
      )) as any
    ).hookSpecificOutput?.permissionDecision;

  const decide = async (tool: string, input: Record<string, unknown>) =>
    (await askPermission(options, ctx.c.signal, tool, input)).behavior;

  return { ...ctx, options, check, decide, asked };
}

/** Asks the launch's permission callback about a tool call. */
export async function askPermission(
  options: Options | undefined,
  signal: AbortSignal,
  tool: string,
  input: Record<string, unknown>,
) {
  assert.ok(options?.canUseTool);

  const result = await options.canUseTool(tool, input, {
    signal,
    toolUseID: "tool",
    requestId: "request",
  });

  assert.ok(result);

  return result;
}

/** The default settings, which leave the session to the user's Claude Code configuration. */
export const parity = resolveClaudePolicy(claudeOverrideDefaults);

/** A successful SDK turn that exposes the options passed to each launch. */
export function captureOptions(
  capture: (options: Options | undefined) => void,
) {
  return (args: { options?: Options }) => {
    capture(args.options);

    return Object.assign(
      (async function* () {
        yield {
          type: "result" as const,
          subtype: "success" as const,
          result: reply,
          total_cost_usd: 0,
          usage: {},
        };
      })(),
      {
        close: () => {},
        // The settings Claude Code reports with no org policy.
        getSettings: async () => ({ effective: {} }),
      },
    ) as unknown as Query;
  };
}
