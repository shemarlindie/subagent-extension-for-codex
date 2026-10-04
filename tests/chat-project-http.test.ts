import assert from "node:assert/strict";
import { test, type TestContext } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Control } from "../src/core/control.js";
import { Store } from "../src/core/store.js";
import { Projects } from "../src/core/projects.js";
import { Workspaces } from "../src/core/workspace.js";
import { Auth } from "../src/server/auth.js";
import { application } from "../src/server/app.js";
import { waitForListening } from "./helpers.js";

async function fixture(t: TestContext) {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "chat-project-http-")),
  );

  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), []),
    new Map(),
    dir,
  );

  c.projects = new Projects(c.store, c.workspaces);
  const html = join(dir, "app.html");
  await writeFile(html, "<!doctype html><title>Project registration</title>");

  const app = application(
    c,
    new Auth("project-test-token"),
    "http://127.0.0.1:4317",
    html,
  );

  const server = app.listen(0, "127.0.0.1");
  await waitForListening(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  t.onTestFinished(async () => {
    await app.locals.closeMcp();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await c.close();
    await rm(dir, { recursive: true, force: true });
  });

  const bearer = {
    Authorization: "Bearer project-test-token",
    "X-Codex-Subagent-Extension": "1",
  };

  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = bearer,
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const login = await post("/api/login", { token: "project-test-token" });

  const cookie = {
    Cookie: login.headers.get("set-cookie")!.split(";")[0],
    "X-Codex-Subagent-Extension": "1",
  };

  async function repo(name: string) {
    const repository = join(dir, name);
    await mkdir(repository, { recursive: true });
    execFileSync("git", ["init", "-q", repository]);

    return repository;
  }

  const setAuto = async (value: boolean) =>
    assert.equal(
      (
        await post(
          "/api/user-tools/update_user_agent_settings",
          { set: { auto_register_chat_project: value } },
          cookie,
        )
      ).status,
      200,
    );

  return { c, base, bearer, post, cookie, repo, setAuto };
}

const hostHeader = (repository: string) => ({
  "X-Codex-Host-Directory": encodeURIComponent(pathToFileURL(repository).href),
});

const startTask = (repository: string) => ({
  description: "Review the current project",
  repository,
});

const registered = (f: { c: Control }) =>
  f.c.projects!.list().map((p) => p.repository);

test("HTTP auto-registration happens only on task start for the trusted thread root", async (t) => {
  const f = await fixture(t);

  const repository = await f.repo("trusted"),
    other = await f.repo("other");

  const header = { ...f.bearer, ...hostHeader(repository) };
  // Read-only tools never register, even with trusted metadata.
  const listed = await f.post("/api/tools/list_agent_projects", {}, header);
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).result, []);

  assert.equal(
    (await f.post("/api/tools/get_agent_panel_context", {}, header)).status,
    200,
  );

  assert.deepEqual(registered(f), []);
  // A task for a different repository does not register the thread root.
  await f.post("/api/tools/start_agent_task", startTask(other), header);
  assert.deepEqual(registered(f), []);

  // Registration precedes task validation, so it holds even if the start fails.
  await f.post(
    "/api/tools/start_agent_task",
    startTask(join(repository, ".")),
    header,
  );

  assert.deepEqual(registered(f), [repository]);
});

test("HTTP auto-registration rejects model opt-out, body and cookie spoofing, and malformed headers", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("trusted");

  const modelChange = await f.post("/api/tools/update_agent_settings", {
    set: { auto_register_chat_project: false },
  });

  assert.equal(modelChange.status, 400);
  assert.equal(f.c.settings.values("local").auto_register_chat_project, true);

  assert.equal(
    (
      await f.post("/api/tools/start_agent_task", {
        ...startTask(repository),
        host_directory: pathToFileURL(repository).href,
      })
    ).status,
    400,
  );

  await f.post("/api/tools/start_agent_task", startTask(repository), {
    ...f.cookie,
    ...hostHeader(repository),
  });

  await f.post("/api/tools/start_agent_task", startTask(repository), {
    ...f.bearer,
    "X-Codex-Host-Directory": "%E0%A4%A",
  });

  assert.deepEqual(registered(f), []);
  await f.setAuto(false);

  await f.post("/api/tools/start_agent_task", startTask(repository), {
    ...f.bearer,
    ...hostHeader(repository),
  });

  assert.deepEqual(registered(f), []);
});

test("MCP get_current_agent_project reports the thread root without registering it", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("mcp-project");
  const client = new Client({ name: "chat-project-test", version: "1.0.0" });
  t.onTestFinished(() => client.close());

  await client.connect(
    new StreamableHTTPClientTransport(new URL(f.base + "/mcp"), {
      requestInit: { headers: { Authorization: "Bearer project-test-token" } },
    }),
  );

  const tools = await client.listTools();
  for (const name of [
    "get_current_agent_project",
    "list_agent_projects",
    "get_agent_panel_context",
    "open_codex_subagent_extension",
  ])
    assert.equal(
      tools.tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint,
      true,
      name,
    );

  const missing = await client.callTool({
    name: "get_current_agent_project",
    arguments: {},
  });

  assert.equal(missing.isError, true);
  assert.match(JSON.stringify(missing.content), /request_agent_project/);

  const _meta = {
    "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(repository).href },
  };

  const result = await client.callTool({
    name: "get_current_agent_project",
    arguments: {},
    _meta,
  });

  assert.notEqual(result.isError, true);

  const current = (result.structuredContent as { result?: unknown } | undefined)
    ?.result as Record<string, unknown>;

  assert.equal(current.repository, repository);
  assert.equal(current.registered, false);
  assert.equal(current.auto_register_on_task_start, true);
  assert.match(String(current.next_step), /request_agent_project/);

  await client.callTool({
    name: "open_codex_subagent_extension",
    arguments: {},
    _meta,
  });

  assert.deepEqual(registered(f), []);
});

test("stdio project registration elicits user approval before granting access", async (t) => {
  const f = await fixture(t);
  const repository = await f.repo("stdio-project");

  const client = new Client(
    { name: "project-form-test", version: "1.0.0" },
    { capabilities: { elicitation: { form: {} } } },
  );

  t.onTestFinished(() => client.close());
  let requests = 0;

  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    requests++;
    assert.deepEqual(f.c.projects!.list(), []);
    assert.equal(request.params.mode, "form");

    if (request.params.mode === "form") {
      assert.equal(
        (
          request.params.requestedSchema.properties.repository as {
            default?: string;
          }
        ).default,
        repository,
      );
    }

    return { action: "accept", content: { repository, decision: "allow" } };
  });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/stdio.js")],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        CODEX_SUBAGENT_EXTENSION_URL: f.base,
        CODEX_SUBAGENT_EXTENSION_TOKEN: "project-test-token",
      },
      stderr: "pipe",
    }),
  );

  const result = await client.callTool({
    name: "request_agent_project",
    arguments: {},
    _meta: {
      "codex/sandbox-state-meta": {
        sandboxCwd: pathToFileURL(repository).href,
      },
    },
  });

  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.equal(requests, 1);

  assert.deepEqual(
    (result.structuredContent as { result?: unknown } | undefined)?.result,
    {
      repository,
      kind: "repository",
    },
  );

  assert.equal(await f.c.projects!.resolve(repository), repository);
  assert.equal(f.c.store.all().length, 0);
});
