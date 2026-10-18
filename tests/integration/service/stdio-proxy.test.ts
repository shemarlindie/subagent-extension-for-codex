import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { test } from "vitest";

import { waitForListening } from "../../support/helpers.js";
import { serviceEnv } from "../../support/service.js";

/** Runs the built proxy against a service on `port`, without the user's overrides. */
async function proxy(t: import("vitest").TestContext, port: number) {
  const data = await mkdtemp(join(tmpdir(), "stdio-proxy-"));

  const client = new Client({ name: "stdio-proxy-test", version: "1" });

  t.onTestFinished(async () => {
    await client.close();
    await rm(data, { recursive: true, force: true });
  });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/stdio.js")],
      env: serviceEnv(
        { data, port },
        { CODEX_SUBAGENT_EXTENSION_TOKEN: "test-token" },
      ),
      stderr: "pipe",
    }),
  );

  return client;
}

test("the proxy completes the MCP handshake while the service is still starting", async (t) => {
  const readyAt = Date.now() + 3000;

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      const ready = Date.now() >= readyAt;
      res.statusCode = ready ? 200 : 503;

      res.end(
        JSON.stringify({
          service: "codex-subagent-extension",
          status: ready ? "ok" : "starting",
        }),
      );

      return;
    }

    if (req.headers.authorization !== "Bearer test-token") {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));

      return;
    }

    res.end(JSON.stringify({ result: { projects: [] } }));
  });

  await waitForListening(server.listen(0, "127.0.0.1"));

  t.onTestFinished(
    () => new Promise<void>((done) => server.close(() => done())),
  );

  const { port } = server.address() as import("node:net").AddressInfo;

  const started = Date.now();
  const client = await proxy(t, port);
  const { tools } = await client.listTools();

  assert.ok(tools.some((tool) => tool.name === "start_task"));

  assert.ok(
    Date.now() < readyAt,
    `the handshake waited ${Date.now() - started} ms for the service`,
  );

  // The first call waits for the service to become ready.
  const result = await client.callTool({
    name: "list_projects",
    arguments: {},
  });

  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.ok(Date.now() >= readyAt);
});
