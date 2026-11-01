import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { test } from "vitest";

import {
  challengeHeader,
  healthProof,
} from "../../../src/service/platform/service/health-proof.js";
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
        { SUBAGENT_EXTENSION_FOR_CODEX_TOKEN: "test-token" },
      ),
      stderr: "pipe",
    }),
  );

  return client;
}

test("the proxy completes the MCP handshake while the service is still starting", async (t) => {
  let ready = false;
  const starting = Promise.withResolvers<void>();
  const stillStarting = Promise.withResolvers<void>();
  let observeCall = false;
  let prematureRequests = 0;

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      res.statusCode = ready ? 200 : 503;

      res.end(
        JSON.stringify({
          service: "subagent-extension-for-codex",
          status: ready ? "ok" : "starting",
          proof: healthProof(
            "test-token",
            String(req.headers[challengeHeader]),
          ),
        }),
      );

      if (!ready) {
        starting.resolve();
        if (observeCall) stillStarting.resolve();
      }

      return;
    }

    if (!ready) {
      prematureRequests++;
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "service is still starting" }));

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

  const client = await proxy(t, port);
  await starting.promise;
  const { tools } = await client.listTools();

  assert.ok(tools.some((tool) => tool.name === "start_task"));

  // The first call waits for the service to become ready.
  let settled = false;

  const call = client
    .callTool({ name: "list_projects", arguments: {} })
    .finally(() => {
      settled = true;
    });

  // Cleanup can reject the call if an earlier assertion fails.
  void call.catch(() => {});

  // A later MCP request completes while the earlier tool call is still held.
  await client.ping();
  // The call must remain pending through another failed readiness probe.
  observeCall = true;
  await Promise.race([stillStarting.promise, call]);
  assert.equal(settled, false);
  ready = true;
  const result = await call;

  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.equal(prematureRequests, 0);
});
