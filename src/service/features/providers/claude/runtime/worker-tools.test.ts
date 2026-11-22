import assert from "node:assert/strict";

import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { onTestFinished, test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import type { RunContext } from "../../types.js";
import {
  askPermission,
  captureOptions,
  context,
  preToolUseHook,
  setClaudeOptions,
} from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

const TOOL = "mcp__delegated_work__update_plan";

async function launch(c: RunContext) {
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => (options = value)),
    readyClaudeCli,
  );

  await provider.run(c, "Work");
  assert.ok(options);

  return options;
}

/** A client connected to the turn's worker tool server. */
async function workerTools(options: Options) {
  const server = options.mcpServers?.delegated_work;
  assert.ok(server?.type === "sdk" && "instance" in server);
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(transport);
  const mcp = new Client({ name: "test", version: "1" });
  await mcp.connect(client);
  onTestFinished(() => mcp.close());

  return {
    mcp,
    call: async (args: Record<string, unknown>) => {
      const result = await mcp.callTool({
        name: "update_plan",
        arguments: args,
      });

      const [content] = result.content as Array<{ text: string }>;

      return { text: content?.text, isError: result.isError === true };
    },
  };
}

test("turns load the worker tools always, allow them in every mode and describe them in the prompt", async () => {
  const { c } = await context();
  setClaudeOptions(c.task, { permission_mode: "default" });
  const asked: string[] = [];

  c.input = async (tool) => {
    asked.push(tool);

    return { approved: false };
  };

  const options = await launch(c);
  const { mcp } = await workerTools(options);
  const settings = options.settings as Settings;

  assert.deepEqual(settings.permissions?.allow, [TOOL]);
  assert.equal(options.allowedTools, undefined);

  const { tools } = await mcp.listTools();

  assert.deepEqual(
    tools.map((t) => t.name),
    ["update_plan"],
  );

  assert.equal(tools[0]?.annotations?.readOnlyHint, true);
  assert.equal(tools[0]?._meta?.["anthropic/alwaysLoad"], true);

  // Without the allow rule, as under managed-only rules, the approver isn't asked.
  assert.equal(
    (await askPermission(options, c.signal, TOOL, { advance: true })).behavior,
    "allow",
  );

  assert.deepEqual(asked, []);

  const prompt = options.systemPrompt;
  assert.ok(typeof prompt === "object" && "append" in prompt);
  assert.match(prompt.append ?? "", /Use update_plan to show your plan/);
});

test("update_plan saves the plan through the run context and answers in one line", async () => {
  const { c, events } = await context();
  const { call } = await workerTools(await launch(c));

  assert.deepEqual(
    await call({
      items: [
        { content: "Read", status: "in_progress" },
        { content: "Report", status: "pending" },
      ],
    }),
    { text: "Plan updated: step 1 of 2 is in progress.", isError: false },
  );

  assert.deepEqual(await call({ advance: true }), {
    text: "Plan updated: step 2 of 2 is in progress.",
    isError: false,
  });

  assert.deepEqual(c.task.plan?.steps, [
    { content: "Read", status: "completed" },
    { content: "Report", status: "in_progress" },
  ]);

  assert.deepEqual(
    events.filter((e) => e.type === "agent.plan").map((e) => e.data.changed),
    [undefined, [0, 1]],
  );

  // An invalid call is an error that changes nothing.
  assert.deepEqual(await call({}), {
    text: "Send one of items, advance: true, or done and start.",
    isError: true,
  });

  assert.equal(c.task.plan?.steps[1]?.status, "in_progress");

  assert.deepEqual(await call({ done: [2] }), {
    text: "Plan updated: all 2 steps are done.",
    isError: false,
  });

  assert.deepEqual(await call({ items: [] }), {
    text: "Plan cleared.",
    isError: false,
  });

  assert.equal(c.task.plan, undefined);
});

test("an open plan returns to the worker after compaction or in a new session, and subagents can't change it", async () => {
  const { c } = await context();
  const options = await launch(c);
  const sessionStart = options.hooks?.SessionStart?.[0]?.hooks[0];
  assert.ok(sessionStart);
  const signal = new AbortController().signal;
  const base = { session_id: "x", transcript_path: "x", cwd: "x" };

  const reminder = async (source: "startup" | "resume" | "compact") => {
    const output = (await sessionStart(
      { ...base, hook_event_name: "SessionStart", source },
      undefined,
      { signal },
    )) as { hookSpecificOutput?: { additionalContext?: string } };

    return output.hookSpecificOutput?.additionalContext;
  };

  const plan = (status: "in_progress" | "completed") => ({
    steps: [
      { content: "Read", status: "completed" as const },
      { content: "Report", status },
    ],
    turn: 1,
    updated_at: "",
  });

  c.task.plan = plan("in_progress");

  const expected = [
    "Your plan for this task, as the user's panel shows it:",
    "1. [completed] Read",
    "2. [in_progress] Report",
    "Keep it current with update_plan: advance as steps finish, use done and start if you're past the step in progress, or send a new list if the work changed.",
  ].join("\n");

  assert.equal(await reminder("compact"), expected);
  assert.equal(await reminder("startup"), expected);
  // A resumed session still has its update_plan calls.
  assert.equal(await reminder("resume"), undefined);
  c.task.plan = plan("completed");
  assert.equal(await reminder("compact"), undefined);

  const decision = async (agent_id?: string) => {
    const output = (await preToolUseHook(options)(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: TOOL,
        tool_input: { advance: true },
        tool_use_id: "x",
        ...(agent_id ? { agent_id } : {}),
      },
      "x",
      { signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string } };

    return output.hookSpecificOutput?.permissionDecision;
  };

  assert.equal(await decision("subagent-1"), "deny");
  assert.equal(await decision(), undefined);
});
