import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { test } from "vitest";

import {
  challengeHeader,
  healthProof,
} from "../../../src/service/platform/service/health-proof.js";
import { waitForListening } from "../../support/helpers.js";
import { freePort, stopService } from "../../support/service.js";

const exec = promisify(execFile);

// The source launcher runs through tsx; it still starts the built dist/main.js.
const launcher = new URL(
  "../../../src/service/platform/service/launcher.ts",
  import.meta.url,
).href;

const tsx = import.meta.resolve("tsx");

async function connect(env: NodeJS.ProcessEnv) {
  const clean = { ...process.env };

  for (const key of Object.keys(clean)) {
    if (key.startsWith("CODEX_SUBAGENT_EXTENSION_") || key === "PORT") {
      delete clean[key];
    }
  }

  return exec(
    process.execPath,
    [
      "--import",
      tsx,
      "--input-type=module",
      "-e",
      `import { connectService } from ${JSON.stringify(launcher)}; console.log(JSON.stringify(await connectService()));`,
    ],
    { env: { ...clean, ...env }, timeout: 20000 },
  );
}

/** A health body proving `token` for the request's challenge, as a real service's does. */
function health(
  req: IncomingMessage,
  token: string,
  body: Record<string, unknown>,
) {
  return JSON.stringify({
    ...body,
    proof: healthProof(token, String(req.headers[challengeHeader])),
  });
}

async function data(t: import("vitest").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "launcher-test-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

async function fake(t: import("vitest").TestContext, handler: RequestListener) {
  const server = createServer(handler);
  await waitForListening(server.listen(0, "127.0.0.1"));

  t.onTestFinished(
    () =>
      new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  );

  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}

/** Stops the service a test's launcher started in `dir`, even when the test fails. */
function stopOnFinish(t: import("vitest").TestContext, dir: string) {
  t.onTestFinished(() => stopService({ data: dir }).catch(() => {}));
}

/** A fake service with the given identity that records drain requests. */
async function identified(
  t: import("vitest").TestContext,
  identity: Record<string, unknown>,
  onDrain: (server: Server) => void = () => {},
) {
  const drains: string[] = [];

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      res.end(
        health(req, "handoff-token", {
          service: "codex-subagent-extension",
          status: "ok",
          ...identity,
        }),
      );

      return;
    }

    if (req.url === "/api/service/drain") {
      drains.push(req.headers.authorization ?? "");
      res.statusCode = 202;
      res.end(JSON.stringify({ status: "draining", running: 0 }));
      onDrain(server);

      return;
    }

    res.end("{}");
  });

  await waitForListening(server.listen(0, "127.0.0.1"));

  t.onTestFinished(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );

  const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;

  return { origin, drains };
}

/** A data directory whose service.json describes a service at `origin`. */
async function serviceData(
  t: import("vitest").TestContext,
  origin: string,
  installRoot: string,
) {
  const dir = await data(t);

  await writeFile(
    join(dir, "service.json"),
    JSON.stringify({ origin, installRoot }),
  );

  await writeFile(join(dir, "admin-token"), "handoff-token");

  return dir;
}

test("launcher uses a service it didn't start whatever its version, and never drains it", async (t) => {
  const { origin, drains } = await identified(t, {
    version: "0.0.1",
    apiVersion: 1,
    launcher: "foreground",
  });

  const dir = await serviceData(t, origin, "/removed/install");
  const result = await connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir });

  assert.deepEqual(JSON.parse(result.stdout), {
    origin,
    token: "handoff-token",
  });

  assert.deepEqual(drains, []);
});

test("launcher refuses an incompatible service it didn't start", async (t) => {
  const { origin, drains } = await identified(t, {
    version: "9.0.0",
    apiVersion: 99,
    launcher: "foreground",
  });

  const dir = await serviceData(t, origin, resolve("."));

  await assert.rejects(
    connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir }),
    /different extension service \(version 9\.0\.0, not started by the plugin\)/,
  );

  assert.deepEqual(drains, []);
  await assert.rejects(access(join(dir, "service.log")));
});

test("launcher drains an older plugin service and keeps using it while it speaks the same API", async (t) => {
  const { origin, drains } = await identified(t, {
    version: "0.0.1",
    apiVersion: 1,
    launcher: "stdio",
  });

  const dir = await serviceData(t, origin, resolve("."));
  const result = await connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir });

  assert.deepEqual(JSON.parse(result.stdout), {
    origin,
    token: "handoff-token",
  });

  assert.deepEqual(drains, ["Bearer handoff-token"]);
});

test(
  "launcher replaces an uninstalled plugin service with an incompatible API once it exits",
  { timeout: 30000 },
  async (t) => {
    const { origin, drains } = await identified(
      t,
      { version: "0.0.1", apiVersion: 0, launcher: "stdio" },
      // The old service exits once asked to drain.
      (server) => {
        server.close();
        server.closeAllConnections();
      },
    );

    const dir = await serviceData(t, origin, join(tmpdir(), "removed-install"));
    stopOnFinish(t, dir);
    const result = await connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir });
    assert.equal(JSON.parse(result.stdout).origin, origin);
    assert.deepEqual(drains, ["Bearer handoff-token"]);

    const health = await (await fetch(`${origin}/health`)).json();
    assert.equal(health.launcher, "stdio");
    assert.equal(health.apiVersion, 1);

    const metadata = JSON.parse(
      await readFile(join(dir, "service.json"), "utf8"),
    );

    assert.equal(metadata.installRoot, resolve("."));
  },
);

test(
  "launcher starts the service again once a stopping service releases the lease",
  { timeout: 30000 },
  async (t) => {
    const dir = await data(t);
    stopOnFinish(t, dir);
    const port = await freePort();

    // A stopping service: it still holds the lease but no longer listens.
    const stopping = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 60000)",
    ]);

    t.onTestFinished(() => void stopping.kill());
    await writeFile(join(dir, "service.pid"), String(stopping.pid));

    const connecting = connect({
      CODEX_SUBAGENT_EXTENSION_DATA: dir,
      PORT: String(port),
    });

    // The first launch loses the lease and exits. Then the old service exits.
    await new Promise((done) => setTimeout(done, 1500));
    stopping.kill();
    const result = JSON.parse((await connecting).stdout);
    assert.equal(result.origin, `http://127.0.0.1:${port}`);

    const health = await (await fetch(`${result.origin}/health`)).json();
    assert.equal(health.status, "ok");
    assert.equal(health.launcher, "stdio");
  },
);

test("launcher discovers service metadata and token without starting another service", async (t) => {
  const dir = await data(t);
  let auth = "";

  const origin = await fake(t, (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      res.end(
        health(req, "persisted-token", {
          service: "codex-subagent-extension",
          apiVersion: 1,
        }),
      );
    } else {
      auth = req.headers.authorization ?? "";
      res.end("{}");
    }
  });

  await writeFile(join(dir, "service.json"), JSON.stringify({ origin }));
  await writeFile(join(dir, "admin-token"), "persisted-token\n");
  const result = await connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir });

  assert.deepEqual(JSON.parse(result.stdout), {
    origin,
    token: "persisted-token",
  });

  assert.equal(auth, "Bearer persisted-token");
  await assert.rejects(access(join(dir, "service.log")));
});

test("incompatible live service and authentication failure never authorize auto-start", async (t) => {
  const dir = await data(t);

  const unrelated = await fake(t, (_req, res) => {
    res.end(JSON.stringify({ service: "other-service" }));
  });

  await writeFile(
    join(dir, "service.json"),
    JSON.stringify({ origin: unrelated }),
  );

  await assert.rejects(
    connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir }),
    /incompatible service/,
  );

  // A service that proves the token but rejects it speaks another protocol.
  const denied = await fake(t, (req, res) => {
    if (req.url === "/health") {
      res.end(health(req, "wrong", { service: "codex-subagent-extension" }));
    } else {
      res.statusCode = 401;
      res.end("{}");
    }
  });

  await writeFile(
    join(dir, "service.json"),
    JSON.stringify({ origin: denied }),
  );

  await writeFile(join(dir, "admin-token"), "wrong");

  await assert.rejects(
    connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir }),
    /token or protocol mismatch/,
  );

  await assert.rejects(access(join(dir, "service.log")));
});

test("launcher never sends the token to a listener that can't prove it holds it", async (t) => {
  const dir = await data(t);
  const sent: string[] = [];

  // Another user's process on the port, imitating the service.
  const impostor = await fake(t, (req, res) => {
    if (req.headers.authorization) sent.push(req.headers.authorization);

    res.end(
      req.url === "/health"
        ? health(req, "guessed-token", {
            service: "codex-subagent-extension",
            status: "ok",
            apiVersion: 1,
          })
        : "{}",
    );
  });

  await writeFile(
    join(dir, "service.json"),
    JSON.stringify({ origin: impostor }),
  );

  await writeFile(join(dir, "admin-token"), "secret-token");

  await assert.rejects(
    connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir }),
    /did not prove it holds this data directory's admin token/,
  );

  assert.deepEqual(sent, []);
  await assert.rejects(access(join(dir, "service.log")));
});

test("launcher waits for an existing service to finish recovery without spawning", async (t) => {
  const dir = await data(t);
  let probes = 0;
  let authenticated = false;

  const origin = await fake(t, (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      probes++;
      res.statusCode = probes < 3 ? 503 : 200;

      res.end(
        health(req, "recovery-token", {
          service: "codex-subagent-extension",
          status: probes < 3 ? "starting" : "ready",
          apiVersion: 1,
        }),
      );
    } else {
      authenticated = req.headers.authorization === "Bearer recovery-token";
      res.end("{}");
    }
  });

  await writeFile(join(dir, "service.json"), JSON.stringify({ origin }));
  await writeFile(join(dir, "admin-token"), "recovery-token");

  assert.deepEqual(
    JSON.parse((await connect({ CODEX_SUBAGENT_EXTENSION_DATA: dir })).stdout),
    { origin, token: "recovery-token" },
  );

  assert.equal(probes, 3);
  assert.equal(authenticated, true);
  await assert.rejects(access(join(dir, "service.log")));
});

test("launcher rejects remote and credential-bearing service URLs", async (t) => {
  const dir = await data(t);

  for (const url of [
    "https://127.0.0.1:17317",
    "http://example.com",
    "http://user:password@127.0.0.1:17317",
    "http://127.0.0.1:17317/path",
  ]) {
    await assert.rejects(
      connect({
        CODEX_SUBAGENT_EXTENSION_DATA: dir,
        CODEX_SUBAGENT_EXTENSION_URL: url,
      }),
      /plain loopback/,
    );
  }

  await assert.rejects(access(join(dir, "service.log")));
});

test(
  "concurrent packaged launchers share one service and token",
  { timeout: 30000 },
  async (t) => {
    const dir = await data(t);
    // Reserve a random port, then release it immediately before launch.
    const reservation = createServer();
    await waitForListening(reservation.listen(0, "127.0.0.1"));
    const port = (reservation.address() as import("node:net").AddressInfo).port;
    await new Promise<void>((done) => reservation.close(() => done()));
    stopOnFinish(t, dir);

    const env = {
      CODEX_SUBAGENT_EXTENSION_DATA: dir,
      PORT: String(port),
    };

    const results = await Promise.all([
      connect(env),
      connect(env),
      connect(env),
    ]);

    const connections = results.map((r) => JSON.parse(r.stdout));
    assert.deepEqual(connections[0], connections[1]);
    assert.deepEqual(connections[0], connections[2]);

    const metadata = JSON.parse(
      await readFile(join(dir, "service.json"), "utf8"),
    );

    const pid = Number(await readFile(join(dir, "service.pid"), "utf8"));
    assert.equal(metadata.pid, pid);
    assert.equal(metadata.origin, connections[0].origin);
    const repeated = JSON.parse((await connect(env)).stdout);
    assert.deepEqual(repeated, connections[0]);

    assert.equal(
      JSON.parse(await readFile(join(dir, "service.json"), "utf8")).pid,
      pid,
    );
  },
);
