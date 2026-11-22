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
    text: "Send either items or advance: true.",
    isError: true,
  });

  assert.equal(c.task.plan?.steps[1]?.status, "in_progress");

  assert.deepEqual(await call({ items: [] }), {
    text: "Plan cleared.",
    isError: false,
  });

  assert.equal(c.task.plan, undefined);
});
