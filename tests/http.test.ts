import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startSchema, now } from "../src/model.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Auth } from "../src/auth.js";
import { Store } from "../src/store.js";
import { Control } from "../src/control.js";
import { Workspaces } from "../src/workspace.js";
import { FixtureProvider } from "../src/providers/fixture.js";
import { application } from "../src/app.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
test("single-use bootstrap, scoped session expiry and token comparison", () => {
  const auth = new Auth("private-token");
  assert.equal(auth.matches("private-token"), true);
  assert.equal(auth.matches("wrong"), false);
  const key = auth.bootstrap("alice");
  const session = auth.exchange(key);
  assert.equal(auth.ownerFor(`ac_session=${session}`), "alice");
  assert.throws(() => auth.exchange(key));
  auth.sessions.get(session)!.expires = 0;
  assert.equal(auth.ownerFor(`ac_session=${session}`), undefined);
});
test("HTTP auth, CSRF, origin checks, MCP tools and UI resource metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ac-http-"));
  const c = new Control(
    new Store(join(dir, "test.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["fixture", new FixtureProvider()]]),
    dir,
  );
  const auth = new Auth("private-token");
  const server = application(
    c,
    auth,
    "http://127.0.0.1:4317",
    resolve("dist/console.html"),
  ).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post("/api/tools/list_agent_tasks", {})).status, 401);
    assert.equal((await post("/api/login", { token: "wrong" })).status, 401);
    assert.equal(
      (
        await post(
          "/api/login",
          { token: "private-token" },
          { Origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    const login = await post("/api/login", { token: "private-token" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal(
      (await post("/api/tools/list_agent_tasks", {}, { Cookie: cookie }))
        .status,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/tools/list_agent_tasks",
          {},
          { Cookie: cookie, "X-Codex-Subagent-Extension": "1" },
        )
      ).status,
      200,
    );
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer private-token" } },
      }),
    );
    assert.equal(client.getServerVersion()?.name, "codex-subagent-extension");
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "start_agent_task"));
    assert.ok(
      tools.tools.some((t) => t.name === "open_codex_subagent_extension"),
    );
    const workers = await client.callTool({
      name: "list_available_workers",
      arguments: {},
    });
    assert.equal(workers.isError, undefined);
    const ui = await client.readResource({
      uri: "ui://codex-subagent-extension/app",
    });
    assert.equal(ui.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.ok((ui.contents[0] as any)._meta.ui.csp.connectDomains.length);
    const open = await client.callTool({
      name: "open_codex_subagent_extension",
      arguments: {},
    });
    assert.ok(open._meta?.bootstrap);
    assert.equal(
      JSON.stringify(open.content).includes(String(open._meta?.bootstrap)),
      false,
    );
    assert.equal(
      (await post("/api/bootstrap", { bootstrap: open._meta?.bootstrap }))
        .status,
      200,
    );
    assert.equal(
      (await post("/api/bootstrap", { bootstrap: open._meta?.bootstrap }))
        .status,
      401,
    );
    await client.close();
    const stdio = new Client({ name: "stdio-test", version: "1.0.0" });
    await stdio.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/stdio.js")],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          ),
          CODEX_SUBAGENT_EXTENSION_URL: base,
          CODEX_SUBAGENT_EXTENSION_TOKEN: "private-token",
        },
        stderr: "pipe",
      }),
    );
    const inventory = await stdio.listTools();
    assert.ok(inventory.tools.some((t) => t.name === "continue_agent_task"));
    const proxyWorkers = await stdio.callTool({
      name: "list_available_workers",
      arguments: {},
    });
    assert.equal(proxyWorkers.isError, false);
    assert.ok(JSON.stringify(proxyWorkers.content).includes("fixture"));
    await stdio.close();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await c.close();
  }
});

test("SSE requires authentication and replays owned events in global cursor order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ac-sse-"));
  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map(),
    dir,
  );
  const auth = new Auth("token");
  const server = application(
    c,
    auth,
    "http://127.0.0.1:4317",
    resolve("dist/console.html"),
  ).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const make = (id: string, owner: string) => ({
    ...startSchema.parse({ task: "test" }),
    id,
    owner,
    status: "queued" as const,
    created_at: now(),
    updated_at: now(),
    attempt: 0,
    runtime_ms: 0,
    instructions: [],
  });
  const a = make("a", "local"),
    b = make("b", "other");
  c.store.save(a);
  c.store.save(b);
  const first = c.store.event(a, "test.first");
  c.store.event(b, "test.secret");
  const last = c.store.event(a, "test.last");
  try {
    assert.equal((await fetch(base + "/api/events")).status, 401);
    const abort = new AbortController();
    const response = await fetch(base + "/api/events", {
      headers: {
        Authorization: "Bearer token",
        "Last-Event-ID": String(first.id),
      },
      signal: abort.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    const data = new TextDecoder().decode(value);
    assert.ok(data.includes(`id: ${last.id}`));
    assert.ok(data.includes("test.last"));
    assert.ok(!data.includes("test.secret"));
    assert.ok(!data.includes("test.first"));
    const pending = reader.read();
    c.store.event(a, "test.live");
    const live = new TextDecoder().decode((await pending).value);
    assert.ok(live.includes("test.live"));
    abort.abort();
    await reader.cancel().catch(() => {});
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await c.close();
  }
});

test("MCP 2.0 discovers events and serves tools/resources on the same authenticated endpoint", async () => {
  const { Events } = await import("../src/events/service.js");
  const dir = await mkdtemp(join(tmpdir(), "ac-modern-"));
  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["fixture", new FixtureProvider()]]),
    dir,
  );
  const events = new Events(
    c.store,
    Buffer.alloc(32, 1),
    async (_url, body) => ({
      status: 200,
      body: JSON.stringify({ challenge: JSON.parse(body).challenge }),
    }),
  );
  const app = application(
    c,
    new Auth("token"),
    "http://127.0.0.1:4317",
    resolve("dist/console.html"),
    events,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const rpc = async (
    method: string,
    args: Record<string, unknown> = {},
    authenticated = true,
  ) => {
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": method,
        ...(args.name || args.uri
          ? { "Mcp-Name": String(args.name ?? args.uri) }
          : {}),
        ...(authenticated ? { Authorization: "Bearer token" } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "1",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const text = await response.text();
    const json = text.startsWith("event:")
      ? JSON.parse(
          text
            .split("\n")
            .find((line) => line.startsWith("data:"))!
            .slice(5),
        )
      : JSON.parse(text);
    return { response, json };
  };
  try {
    assert.equal((await rpc("events/list", {}, false)).response.status, 401);
    const discovery = await rpc("server/discover");
    assert.equal(discovery.response.status, 200);
    assert.equal(discovery.json.result.resultType, "complete");
    assert.ok(discovery.json.result.capabilities.events);
    assert.ok(discovery.json.result.capabilities.tools);
    assert.ok(discovery.json.result.capabilities.resources);
    assert.deepEqual(
      discovery.json.result.capabilities.extensions["openai/settings"],
      {
        readTool: "get_agent_settings",
        updateTool: "update_agent_settings",
      },
    );
    assert.ok(discovery.json.result.supportedVersions.includes("2026-07-28"));
    const catalog = await rpc("events/list");
    assert.equal(catalog.json.result.events.length, 3);
    assert.equal(catalog.json.result.resultType, "complete");
    const tools = await rpc("tools/list");
    const settings = await rpc("tools/call", {
      name: "get_agent_settings",
      arguments: {},
    });
    assert.equal(
      settings.json.result.structuredContent.values.default_provider,
      "fixture",
    );
    assert.equal(settings.json.result.structuredContent.schema.type, "object");
    assert.equal(
      settings.json.result.structuredContent.layout[0].kind,
      "group",
    );
    const updated = await rpc("tools/call", {
      name: "update_agent_settings",
      arguments: { set: { max_cost_usd: 2 } },
    });
    assert.equal(updated.json.result.structuredContent.values.max_cost_usd, 2);
    const invalid = await rpc("tools/call", {
      name: "update_agent_settings",
      arguments: { set: { max_cost_usd: -1 } },
    });
    assert.ok(invalid.json.result?.isError || invalid.json.error);
    assert.ok(
      tools.json.result.tools.some((t: any) => t.name === "start_agent_task"),
    );
    const result = await rpc("tools/call", {
      name: "list_available_workers",
      arguments: {},
    });
    assert.ok(result.json.result, JSON.stringify(result.json));
    assert.ok(
      result.json.result.structuredContent.result.some(
        (w: any) => w.provider === "fixture",
      ),
    );
    const resource = await rpc("resources/read", {
      uri: "ui://codex-subagent-extension/app",
    });
    assert.equal(
      resource.json.result.contents[0].mimeType,
      "text/html;profile=mcp-app",
    );
    const delivery = {
      mode: "webhook",
      url: "https://receiver.example/callback",
      secret: "whsec_" + Buffer.alloc(32, 7).toString("base64"),
    };
    const subscribed = await rpc("events/subscribe", {
      name: "agent_task.completed",
      arguments: {},
      delivery,
      cursor: null,
    });
    assert.ok(subscribed.json.result.id);
    const removed = await rpc("events/unsubscribe", {
      name: "agent_task.completed",
      arguments: {},
      delivery: { mode: delivery.mode, url: delivery.url },
    });
    assert.equal(removed.json.result.resultType, "complete");
  } finally {
    await app.locals.closeMcp();
    await events.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await c.close();
  }
});
