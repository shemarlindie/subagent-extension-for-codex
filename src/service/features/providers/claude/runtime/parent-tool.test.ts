import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test, vi } from "vitest";

import type { RunContext } from "../../types.js";
import { parentServer } from "./parent-tool.js";

async function connect(conversation: string | undefined) {
  const messageParent = vi.fn(() => 27);

  const server = parentServer({
    task: { conversation_id: conversation },
    messageParent,
  } as unknown as RunContext);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "parent-tool-test", version: "1" });
  await server.instance.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    messageParent,
    close: async () => {
      await client.close();
      await server.instance.close();
    },
  };
}

test("injected SDK tool validates input and queues only into its bound parent context", async () => {
  const fixture = await connect("parent-chat");

  try {
    const result = await fixture.client.callTool({
      name: "message_parent",
      arguments: { message: "  Done  " },
    });

    expect(result.isError).not.toBe(true);

    expect(result.content).toEqual([
      {
        type: "text",
        text: "Queued parent message parent_27. Host delivery is pending.",
      },
    ]);

    expect(fixture.messageParent).toHaveBeenCalledExactlyOnceWith("Done");

    const blank = await fixture.client.callTool({
      name: "message_parent",
      arguments: { message: " " },
    });

    expect(blank.isError).toBe(true);
    expect(fixture.messageParent).toHaveBeenCalledTimes(1);
  } finally {
    await fixture.close();
  }
});

test("SDK tool reports tasks with no parent route instead of queueing", async () => {
  const fixture = await connect(undefined);

  try {
    const result = await fixture.client.callTool({
      name: "message_parent",
      arguments: { message: "Done" },
    });

    expect(result.isError).toBe(true);
    expect(fixture.messageParent).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});
