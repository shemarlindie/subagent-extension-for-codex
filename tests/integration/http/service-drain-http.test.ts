import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { application } from "../../../src/service/platform/server/app.js";
import { Auth } from "../../../src/service/platform/server/auth.js";
import { waitForListening } from "../../support/helpers.js";
import { sessionCookie } from "./http-test-harness.js";

const token = "drain-test-token-with-enough-length";

/** The service app on a loopback port, with request helpers. */
async function service(t: import("vitest").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "service-drain-"));
  const html = join(dir, "app.html");
  await writeFile(html, "<html>__API_ORIGIN__</html>");
  const store = new Store(join(dir, "test.sqlite"));

  const control = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), []),
    new Map(),
  );

  const app = application(
    control,
    new Auth(token),
    "http://127.0.0.1:17317",
    html,
  );

  const server = app.listen(0, "127.0.0.1");
  await waitForListening(server);

  t.onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;

  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Subagent-Extension-For-Codex": "1",
        ...headers,
      },
      body: "{}",
    });

  const health = async () => {
    const response = await fetch(`${base}/health`);

    return { status: response.status, body: await response.json() };
  };

  return { app, control, base, post, health };
}

const bearer = { Authorization: `Bearer ${token}` };

test("drain requires a hook and administrator token, then closes connections", async (t) => {
  const { app, control, base, post, health } = await service(t);
  assert.equal((await post("/api/service/drain", bearer)).status, 501);
  let drains = 0;

  app.locals.drain = () => {
    drains++;
    control.draining = true;

    return 2;
  };

  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  const cookie = sessionCookie(login);

  assert.equal(
    (await post("/api/service/drain", { Cookie: cookie })).status,
    403,
  );

  assert.equal(drains, 0);

  const drained = await post("/api/service/drain", bearer);
  assert.equal(drained.status, 202);
  assert.deepEqual(await drained.json(), { status: "draining", running: 2 });
  assert.equal(drains, 1);

  const status = await health();
  assert.equal(status.status, 200);
  assert.equal(status.body.status, "draining");

  const call = await post("/api/tools/list_tasks", bearer);
  assert.equal(call.status, 200);
  assert.equal(call.headers.get("connection"), "close");
});

test("a stopping service reports it and refuses calls", async (t) => {
  const { app, post, health } = await service(t);
  app.locals.stopping = true;

  const status = await health();
  assert.equal(status.status, 503);
  assert.equal(status.body.status, "stopping");

  const call = await post("/api/tools/list_tasks", bearer);
  assert.equal(call.status, 503);
  assert.deepEqual(await call.json(), { error: "The service is stopping" });
});

test("draining ends held update waits with a view that says the service is updating", async (t) => {
  const { control, base } = await service(t);

  const wait = async (body: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/user-tools/app_wait_for_updates`, {
      method: "POST",
      headers: {
        ...bearer,
        "Content-Type": "application/json",
        "X-Subagent-Extension-For-Codex": "1",
      },
      body: JSON.stringify(body),
    });

    return (await response.json()).result;
  };

  const view = { list: {} };
  const first = await wait({ view });
  assert.equal(first.view.updating, undefined);

  // Whether the drain lands before or after the wait starts, only a new
  // revision returns it early.
  const held = wait({ after: first.revision, view, wait_ms: 20000 });
  const started = Date.now();
  await control.drain(0);
  const read = await held;

  assert.ok(Date.now() - started < 5000);
  assert.notEqual(read.revision, first.revision);
  assert.equal(read.view.updating, true);
});
