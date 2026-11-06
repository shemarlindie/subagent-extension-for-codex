import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { test } from "vitest";

import {
  challengeHeader,
  healthProof,
} from "../../../src/service/platform/service/health-proof.js";
import { serviceIdentity } from "../../../src/service/platform/service/identity.js";
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

const token = "test-token";

/** A loopback server standing in for the service. Returns its port. */
async function stubService(
  t: import("vitest").TestContext,
  listener: RequestListener,
) {
  const server = createServer(listener);
  await waitForListening(server.listen(0, "127.0.0.1"));

  t.onTestFinished(
    () => new Promise<void>((done) => server.close(() => done())),
  );

  return (server.address() as import("node:net").AddressInfo).port;
}

function answerHealth(req: IncomingMessage, res: ServerResponse, ready = true) {
  res.statusCode = ready ? 200 : 503;

  res.end(
    JSON.stringify({
      service: "subagent-extension-for-codex",
      status: ready ? "ok" : "starting",
      apiVersion: serviceIdentity().apiVersion,
      proof: healthProof(token, String(req.headers[challengeHeader])),
    }),
  );
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

  const port = await stubService(t, (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      answerHealth(req, res, ready);

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

    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));

      return;
    }

    res.end(JSON.stringify({ result: { projects: [] } }));
  });

  const { client, stderr } = await proxy(
    t,
    { data: await data(t), port },
    { SUBAGENT_EXTENSION_FOR_CODEX_TOKEN: token },
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

test("a failed call gives the service's message and says when a send was rejected", async (t) => {
  const port = await stubService(t, (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") return answerHealth(req, res);

    // The proxy lists projects to check its token when it connects.
    if (req.url?.endsWith("/list_projects")) {
      return res.end(JSON.stringify({ result: { projects: [] } }));
    }

    res.statusCode = 400;

    res.end(
      JSON.stringify(
        req.url?.endsWith("/send_message")
          ? { error: "Send refused", send_rejected: true }
          : { error: "Not found" },
      ),
    );
  });

  const { client } = await proxy(
    t,
    { data: await data(t), port },
    { SUBAGENT_EXTENSION_FOR_CODEX_TOKEN: token },
  );

  assert.deepEqual(
    await client.callTool({
      name: "send_message",
      arguments: { task_id: "task", message: "Next" },
    }),
    {
      isError: true,
      _meta: { send_rejected: true },
      content: [{ type: "text", text: "Send refused" }],
    },
  );

  assert.deepEqual(
    await client.callTool({
      name: "get_task",
      arguments: { task_id: "task" },
    }),
    { isError: true, content: [{ type: "text", text: "Not found" }] },
  );
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
