import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { test, type TestContext } from "vitest";

import { FixtureProvider } from "../../../dev/service/fixture-provider.js";
import { claudeTaskPolicy } from "../../../src/service/features/providers/claude/configuration/task-policy.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { application } from "../../../src/service/platform/server/app.js";
import { Auth } from "../../../src/service/platform/server/auth.js";
import { claudeMetadata } from "../../../src/shared/providers/metadata.js";
import { waitForListening } from "../../support/helpers.js";

const parentMeta = {
  "codex/sandbox-state-meta": {
    sandboxPolicy: { type: "workspace-write" },
    approvalPolicy: "untrusted",
  },
};

async function setup(t: TestContext) {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "native-permission-http-")),
  );

  execFileSync("git", ["init", "-q", dir]);

  execFileSync("git", [
    "-C",
    dir,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  ]);

  const provider = new FixtureProvider();
  provider.id = "claude";
  provider.taskPolicy = claudeTaskPolicy;
  provider.metadata = claudeMetadata;

  const c = new Control(
    new Store(join(dir, "tasks.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["claude", provider]]),
    dir,
  );

  const app = application(
    c,
    new Auth("test-token"),
    "http://127.0.0.1:4317",
    resolve("dist/app.html"),
  );

  const server = app.listen(0, "127.0.0.1");
  await waitForListening(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  t.onTestFinished(async () => {
    await app.locals.closeMcp();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await c.close();
    await rm(dir, { recursive: true, force: true });
  });

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

  const rpc = async (name: string, args: object, meta: object = {}) => {
    const res = await post(
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "permission-tests",
              version: "1",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
            ...meta,
          },
        },
      },
      {
        Authorization: "Bearer test-token",
        Accept: "application/json, text/event-stream",
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
        "MCP-Protocol-Version": "2026-07-28",
      },
    );

    assert.equal(res.status, 200);
    const text = await res.text();

    return JSON.parse(
      text.startsWith("event:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data:"))!
            .slice(5)
        : text,
    );
  };

  const request = {
    repository: dir,
    provider: "claude",
    worker_profile: "implementer",
    description: "Implement a change",
    workspace_strategy: "current_repo",
  };

  return { c, base, dir, rpc, post, request };
}

test("HTTP MCP resolves the extension permission setting regardless of host or argument permission metadata", async (t) => {
  const { c, rpc, request } = await setup(t);
  c.settings.update("local", { set: { claude_permission_mode: "auto" } });
  const started = await rpc("start_agent_task", request, parentMeta);
  assert.equal(started.result.isError, undefined, JSON.stringify(started));
  const task = started.result.structuredContent.result;
  assert.equal(task.provider_options.claude.permission_mode, "auto");
  assert.equal(task.provider_options.claude.permission_source, "setting");

  assert.equal(
    c.store.get(task.id, "local").provider_options?.claude?.permission_mode,
    "auto",
  );

  const spoofed = await rpc("start_agent_task", {
    ...request,
    parent_permissions: {
      provider: "claude",
      permission_mode: "bypassPermissions",
    },
    _meta: parentMeta,
  });

  assert.equal(spoofed.result.isError, undefined, JSON.stringify(spoofed));

  assert.equal(
    spoofed.result.structuredContent.result.provider_options.claude
      .permission_mode,
    "auto",
  );

  assert.equal(
    spoofed.result.structuredContent.result.provider_options.claude
      .permission_source,
    "setting",
  );
});

test("cookie-authenticated user tasks use the extension permission setting across profiles", async (t) => {
  const { c, post, request } = await setup(t);
  c.settings.update("local", { set: { claude_permission_mode: "auto" } });
  const login = await post("/api/login", { token: "test-token" });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];

  for (const worker_profile of ["reviewer", "implementer"]) {
    const res = await post(
      "/api/user-tools/start_user_agent_task",
      { ...request, worker_profile },
      {
        Cookie: cookie,
        "X-Codex-Subagent-Extension": "1",
        "X-Codex-Parent-Permissions": JSON.stringify({
          provider: "claude",
          permission_mode: "bypassPermissions",
        }),
      },
    );

    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.equal(result.provider_options.claude.permission_mode, "auto");
    assert.equal(result.provider_options.claude.permission_source, "setting");
  }
});

test("stdio proxy starts tasks with the extension permission setting", async (t) => {
  const { base, c, request } = await setup(t);
  c.settings.update("local", { set: { claude_permission_mode: "auto" } });
  const client = new Client({ name: "permission-stdio-test", version: "1" });

  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", resolve("src/service/stdio.ts")],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          ),
          CODEX_SUBAGENT_EXTENSION_URL: base,
          CODEX_SUBAGENT_EXTENSION_TOKEN: "test-token",
        },
        stderr: "pipe",
      }),
    );

    const response = await client.callTool({
      name: "start_agent_task",
      arguments: request,
      _meta: parentMeta,
    });

    assert.equal(response.isError, false, JSON.stringify(response));
    const task = (response.structuredContent as any).result;
    assert.equal(task.provider_options.claude.permission_mode, "auto");
    assert.equal(task.provider_options.claude.permission_source, "setting");

    assert.equal(
      c.store.get(task.id, "local").provider_options?.claude?.permission_mode,
      "auto",
    );
  } finally {
    await client.close();
  }
});
