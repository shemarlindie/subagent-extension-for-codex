import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import {
  freePort,
  type Service,
  serviceEnv,
  stopService,
} from "../../support/service.js";

/** A short idle grace, so the tests don't wait out the real one. */
const idleGrace = 1000;

async function data(t: import("vitest").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "stdio-proxy-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

/** Runs the built proxy against `service`, without the user's overrides. */
async function proxy(
  t: import("vitest").TestContext,
  service: Service,
  overrides: Record<string, string> = {},
) {
  const client = new Client({ name: "stdio-proxy-test", version: "1" });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/stdio.js")],
    env: serviceEnv(service, overrides),
    stderr: "pipe",
  });

  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));
  t.onTestFinished(() => client.close());
  await client.connect(transport);

  return { client, pid: transport.pid!, stderr: () => stderr };
}

function running(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

/** Waits for an idle stop, with ten seconds for the stop itself. */
async function waitForExit(pid: number) {
  for (let i = 0; i < (idleGrace + 10000) / 100 && running(pid); i++) {
    await new Promise((done) => setTimeout(done, 100));
  }

  assert.equal(running(pid), false, `process ${pid} is still running`);
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

  const { client, stderr } = await proxy(
    t,
    { data: await data(t), port },
    { SUBAGENT_EXTENSION_FOR_CODEX_TOKEN: "test-token" },
  );

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

  // Codex records this line, which tells a closed stdin from a signal.
  await client.close();
  assert.match(stderr(), /Proxy stopping: stdin closed/);
});

test(
  "a service the proxy started outlives a killed proxy while another remains, and exits once the last one closes",
  { timeout: idleGrace * 2 + 30000 },
  async (t) => {
    const service = { data: await data(t), port: await freePort() };
    t.onTestFinished(() => stopService(service).catch(() => {}));

    const grace = {
      SUBAGENT_EXTENSION_FOR_CODEX_IDLE_GRACE_MS: String(idleGrace),
    };

    const first = await proxy(t, service, grace);
    const second = await proxy(t, service, grace);

    for (const { client } of [first, second]) {
      const result = await client.callTool({
        name: "list_projects",
        arguments: {},
      });

      assert.ok(!result.isError, JSON.stringify(result.content));
    }

    const pid = Number(
      await readFile(join(service.data, "service.pid"), "utf8"),
    );

    // A killed proxy can't say goodbye. Its closed socket is enough.
    process.kill(first.pid, "SIGKILL");
    // Past the grace and the next idle check, the service would have stopped.
    await new Promise((done) => setTimeout(done, idleGrace + 2000));
    assert.ok(running(pid), "the service stopped while a proxy remained");

    await second.client.close();
    await waitForExit(pid);
  },
);
