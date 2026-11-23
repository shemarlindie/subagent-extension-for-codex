import assert from "node:assert/strict";

import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { onTestFinished, test, vi } from "vitest";

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
const VISUAL_TOOL = "mcp__delegated_work__show_visual";

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
    call: async (args: Record<string, unknown>, name = "update_plan") => {
      const result = await mcp.callTool({ name, arguments: args });

      const [content] = result.content as Array<{ text: string }>;

      return { text: content?.text, isError: result.isError === true };
    },
  };
}

test("turns load the worker tools always and allow them in every mode", async () => {
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

  assert.deepEqual(settings.permissions?.allow, [TOOL, VISUAL_TOOL]);
  assert.equal(options.allowedTools, undefined);

  const { tools } = await mcp.listTools();
  assert.equal(tools.length, 2);

  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool._meta?.["anthropic/alwaysLoad"], true, tool.name);
  }

  // Without the allow rule, as under managed-only rules, the approver isn't asked.
  assert.equal(
    (await askPermission(options, c.signal, TOOL, { advance: true })).behavior,
    "allow",
  );

  assert.deepEqual(asked, []);
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
});

test("show_visual records the visual through the run context and names its number", async () => {
  const { c } = await context();
  const { call } = await workerTools(await launch(c));
  const visual = { title: "Signups", code: "<svg></svg>" };

  assert.deepEqual(await call(visual, "show_visual"), {
    text: "Shown as visual 1.",
    isError: false,
  });

  assert.deepEqual(await call({ ...visual, replaces: 1 }, "show_visual"), {
    text: "Visual 1 replaced.",
    isError: false,
  });

  assert.deepEqual(vi.mocked(c.visualShown).mock.calls, [
    ["Signups", "<svg></svg>", undefined],
    ["Signups", "<svg></svg>", 1],
  ]);

  // The service's refusal reaches the worker as an error.
  vi.mocked(c.visualShown).mockImplementation(() => {
    throw new Error("There is no visual 4.");
  });

  assert.deepEqual(await call({ ...visual, replaces: 4 }, "show_visual"), {
    text: "There is no visual 4.",
    isError: true,
  });
});

test("an open plan returns to the worker after compaction, and subagents can't change it", async () => {
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
  });

  c.task.plan = plan("in_progress");

  const expected = [
    "Your plan for this task, as the user's panel shows it:",
    "1. [completed] Read",
    "2. [in_progress] Report",
    "Keep it current with update_plan: advance as steps finish, use done and start if you're past the step in progress, or send a new list if the work changed.",
  ].join("\n");

  assert.equal(await reminder("compact"), expected);
  assert.equal(await reminder("startup"), undefined);
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
