import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dataDirectory, installRoot } from "../src/service/runtime.js";
const exec = promisify(execFile);
const launcher = new URL("../dist/service/launcher.js", import.meta.url).href;
async function connect(env: NodeJS.ProcessEnv) {
  const clean = { ...process.env };
  for (const key of Object.keys(clean))
    if (key.startsWith("CODEX_SUBAGENT_EXTENSION_") || key === "PORT")
      delete clean[key];
  return exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { connectService } from ${JSON.stringify(launcher)}; console.log(JSON.stringify(await connectService()));`,
    ],
    { env: { ...clean, ...env }, timeout: 20000 },
  );
}
async function data(t: import("node:test").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "launcher-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function fake(
  t: import("node:test").TestContext,
  handler: Parameters<typeof createServer>[0],
) {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(
    () =>
      new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  );
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}

test("data directory override is independent of packaged installation directory", () => {
  assert.equal(
    dataDirectory({ CODEX_SUBAGENT_EXTENSION_DATA: "/tmp/custom-agent-data" }),
    "/tmp/custom-agent-data",
  );
  assert.equal(
    dataDirectory({ CODEX_SUBAGENT_EXTENSION_DATA: "relative-agent-data" }),
    resolve("relative-agent-data"),
  );
});

// The runtime module sits two levels below the package root in both src/ and dist/.
test("install root resolves to the package root from source and build output", async () => {
  const built = await import(
    new URL("../dist/service/runtime.js", import.meta.url).href
  );
  assert.equal(installRoot, resolve("."));
  assert.equal(built.installRoot, resolve("."));
});

test("launcher discovers service metadata and token without starting another service", async (t) => {
  const dir = await data(t);
  let auth = "";
  const origin = await fake(t, (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health")
      res.end(JSON.stringify({ service: "codex-subagent-extension" }));
    else {
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
  const denied = await fake(t, (req, res) => {
    if (req.url === "/health")
      res.end(JSON.stringify({ service: "codex-subagent-extension" }));
    else {
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
        JSON.stringify({
          service: "codex-subagent-extension",
          status: probes < 3 ? "starting" : "ready",
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
    "https://127.0.0.1:4317",
    "http://example.com",
    "http://user:password@127.0.0.1:4317",
    "http://127.0.0.1:4317/path",
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
    await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
    const port = (reservation.address() as import("node:net").AddressInfo).port;
    await new Promise<void>((done) => reservation.close(() => done()));
    let pid: number | undefined;
    t.after(async () => {
      try {
        pid ??= Number(await readFile(join(dir, "service.pid"), "utf8"));
      } catch {}
      if (!pid) return;
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
      for (let i = 0; i < 100; i++) {
        try {
          process.kill(pid, 0);
        } catch {
          return;
        }
        await new Promise((done) => setTimeout(done, 20));
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    });
    const env = {
      CODEX_SUBAGENT_EXTENSION_DATA: dir,
      CODEX_SUBAGENT_EXTENSION_PROVIDER: "fixture",
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
    pid = Number(await readFile(join(dir, "service.pid"), "utf8"));
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
