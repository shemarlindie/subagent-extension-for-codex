import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";

import { test, type TestContext } from "vitest";

import {
  serviceClient,
  type ServiceConnection,
} from "../../../src/service/platform/service/service-client.js";
import { waitForListening } from "../../support/helpers.js";
import { freePort } from "../../support/service.js";

/** A loopback service answering with `handler`, and how many requests it got. */
async function fakeService(t: TestContext, handler: RequestListener) {
  let requests = 0;

  const server = createServer((req, res) => {
    requests++;
    handler(req, res);
  });

  await waitForListening(server.listen(0, "127.0.0.1"));

  t.onTestFinished(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );

  const { port } = server.address() as import("node:net").AddressInfo;

  return {
    connection: { origin: `http://127.0.0.1:${port}`, token: "token" },
    requests: () => requests,
  };
}

const ok: RequestListener = (_req, res) => res.end('{"result":"ok"}');

/** Closes the socket without answering, as a service exiting mid-call does. */
const reset: RequestListener = (req) => req.socket.destroy();

/** A connect function returning each connection in turn, counting calls. */
function connections(...list: ServiceConnection[]) {
  let calls = 0;

  return {
    connect: async () => {
      const connection = list[Math.min(calls++, list.length - 1)];
      assert.ok(connection);

      return connection;
    },
    calls: () => calls,
  };
}

test("a call to a stopped service reconnects and is sent again", async (t) => {
  const stopped = {
    origin: `http://127.0.0.1:${await freePort()}`,
    token: "old",
  };

  const live = await fakeService(t, ok);
  const { connect, calls } = connections(stopped, live.connection);
  const client = serviceClient(connect);

  const response = await client.post(
    "tools/start_task",
    {},
    {
      timeout: 5000,
    },
  );

  assert.deepEqual(await response.json(), { result: "ok" });
  assert.equal(calls(), 2);
});

test("a reset write is not sent again, but a reset read is", async (t) => {
  const exiting = await fakeService(t, reset);
  const live = await fakeService(t, ok);

  const write = connections(exiting.connection, live.connection);

  await assert.rejects(
    serviceClient(write.connect).post(
      "tools/start_task",
      {},
      {
        timeout: 5000,
      },
    ),
  );

  assert.equal(write.calls(), 1);
  assert.equal(live.requests(), 0);

  const read = connections(exiting.connection, live.connection);

  const response = await serviceClient(read.connect).post(
    "tools/list_tasks",
    {},
    { timeout: 5000, readOnly: true },
  );

  assert.equal(response.status, 200);
  assert.equal(read.calls(), 2);
});

test("a failed connection attempt is forgotten, and a slow one times out", async (t) => {
  const live = await fakeService(t, ok);
  let attempts = 0;

  const client = serviceClient(async () => {
    if (++attempts === 1) throw new Error("Service startup failed");

    return live.connection;
  });

  await assert.rejects(
    client.post("tools/list_tasks", {}, { timeout: 5000 }),
    /Service startup failed/,
  );

  const response = await client.post(
    "tools/list_tasks",
    {},
    {
      timeout: 5000,
    },
  );

  assert.equal(response.status, 200);

  const slow = serviceClient(() => new Promise(() => {}), 50);

  await assert.rejects(
    slow.post("tools/list_tasks", {}, { timeout: 5000 }),
    /did not start within 0\.05 s/,
  );
});
