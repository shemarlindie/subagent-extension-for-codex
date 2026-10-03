import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Auth } from "../src/server/auth.js";
import { Store } from "../src/core/store.js";
import { Control } from "../src/core/control.js";
import { Workspaces } from "../src/core/workspace.js";
import { FixtureProvider } from "../src/providers/fixture.js";
import { type Result, type RunContext } from "../src/core/model.js";
import { application } from "../src/server/app.js";

class PermissionProvider extends FixtureProvider {
  async run(ctx: RunContext): Promise<Result> {
    const answer = await ctx.input("Bash", { command: "pwd" }, ctx.signal);
    return {
      summary: JSON.stringify(answer),
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  }
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for task");
}
async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "approval-http-")));
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
  const html = join(dir, "app.html");
  await writeFile(html, "<!doctype html><title>Approval test</title>");
  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["fixture", new PermissionProvider()]]),
    dir,
  );
  const app = application(
    c,
    new Auth("test-token"),
    "http://127.0.0.1:4317",
    html,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const bearer = {
    Authorization: "Bearer test-token",
    "X-Codex-Subagent-Extension": "1",
  };
  const post = (
    path: string,
    args: unknown,
    headers: Record<string, string> = bearer,
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(args),
    });
  const login = await post("/api/login", { token: "test-token" });
  const cookie = {
    Cookie: login.headers.get("set-cookie")!.split(";")[0],
    "X-Codex-Subagent-Extension": "1",
  };
  const start = {
    provider: "fixture",
    description: "Request permission",
    repository: dir,
    workspace_strategy: "current_repo",
  };
  const pending = async (id: string) => {
    await until(() => !!c.store.get(id, "local").pending_input);
    return {
      task_id: id,
      request_id: c.store.get(id, "local").pending_input!.id,
      approved: true,
    };
  };
  return {
    c,
    base,
    post,
    bearer,
    cookie,
    start,
    pending,
    cleanup: async () => {
      await app.locals.closeMcp();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await c.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("console cookie can configure modes and approve while generic bearer API cannot", async () => {
  const { c, post, cookie, start, pending, cleanup } = await setup();
  try {
    const change = { set: { default_approval_mode: "parent_agent" } };
    const blocked = await post("/api/tools/update_agent_settings", change);
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /require a user decision/);
    assert.equal(
      (await post("/api/tools/update_agent_settings", change, cookie)).status,
      200,
    );
    assert.equal(
      c.settings.values("local").default_approval_mode,
      "parent_agent",
    );
    assert.equal(
      (
        await post(
          "/api/tools/update_agent_settings",
          { set: { default_approval_mode: "ask_user" } },
          cookie,
        )
      ).status,
      200,
    );
    const started = await post("/api/tools/start_agent_task", start);
    assert.equal(started.status, 200);
    const id = (await started.json()).result.id;
    const approval = await pending(id);
    for (const approved of [true, false]) {
      const decision = await post("/api/tools/submit_agent_input", {
        ...approval,
        approved,
      });
      assert.equal(decision.status, 400);
      assert.match((await decision.json()).error, /requires user approval/);
    }
    assert.equal(
      c.store.get(id, "local").pending_input?.id,
      approval.request_id,
    );
    assert.equal(
      (await post("/api/tools/submit_agent_input", approval, cookie)).status,
      200,
    );
    await until(() => c.store.get(id, "local").status === "completed");
    assert.equal(
      JSON.parse(c.store.get(id, "local").result!.summary).approved,
      true,
    );
  } finally {
    await cleanup();
  }
});

test("authenticated admin user-tools route supports user settings, starts, and decisions", async () => {
  const { c, post, start, pending, cleanup } = await setup();
  try {
    // The bearer token authorizes this explicit admin route; generic tools retain parent authority.
    assert.equal(
      (
        await post("/api/user-tools/update_user_agent_settings", {
          set: { default_approval_mode: "deny" },
        })
      ).status,
      200,
    );
    assert.equal(c.settings.values("local").default_approval_mode, "deny");
    const restricted = await post("/api/tools/start_agent_task", {
      ...start,
      approval_mode: "ask_user",
    });
    assert.equal(restricted.status, 400);
    const started = await post("/api/user-tools/start_user_agent_task", {
      ...start,
      approval_mode: "ask_user",
    });
    assert.equal(started.status, 200);
    const id = (await started.json()).result.id;
    const approval = await pending(id);
    assert.equal(
      (await post("/api/tools/submit_user_agent_input", approval)).status,
      400,
    );
    assert.equal(
      (await post("/api/user-tools/submit_user_agent_input", approval)).status,
      200,
    );
    await until(() => c.store.get(id, "local").status === "completed");
    assert.equal(
      JSON.parse(c.store.get(id, "local").result!.summary).approved,
      true,
    );
    assert.equal(
      (
        await post("/api/user-tools/update_agent_settings", {
          set: { default_approval_mode: "auto_approve" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await post("/api/user-tools/update_user_agent_settings", {}, {})).status,
      401,
    );
  } finally {
    await cleanup();
  }
});

test("MCP advertises app-only aliases and enforces approval policy for model-facing tools", async () => {
  const { c, base, post, cookie, start, pending, cleanup } = await setup();
  const client = new Client({ name: "approval-test", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer test-token" } },
      }),
    );
    const { tools } = await client.listTools();
    for (const name of [
      "start_user_agent_task",
      "submit_user_agent_input",
      "update_user_agent_settings",
    ]) {
      const tool = tools.find((entry) => entry.name === name);
      assert.ok(tool, `${name} must be available to the app`);
      assert.deepEqual((tool._meta as any).ui.visibility, ["app"]);
    }
    assert.deepEqual(
      (tools.find((entry) => entry.name === "submit_agent_input")!._meta as any)
        .ui.visibility,
      ["model", "app"],
    );
    const raised = await client.callTool({
      name: "update_agent_settings",
      arguments: { set: { default_approval_mode: "parent_agent" } },
    });
    assert.equal(raised.isError, true);
    const started = await client.callTool({
      name: "start_agent_task",
      arguments: start,
    });
    assert.notEqual(started.isError, true);
    const id = (started.structuredContent?.result as { id: string }).id;
    const approval = await pending(id);
    const blocked = await client.callTool({
      name: "submit_agent_input",
      arguments: approval,
    });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked.content), /requires user approval/);
    assert.equal(
      (await post("/api/tools/submit_agent_input", approval, cookie)).status,
      200,
    );
    await until(() => c.store.get(id, "local").status === "completed");
    assert.equal(
      (
        await post(
          "/api/tools/update_agent_settings",
          { set: { default_approval_mode: "parent_agent" } },
          cookie,
        )
      ).status,
      200,
    );
    const delegated = await client.callTool({
      name: "start_agent_task",
      arguments: start,
    });
    const delegatedId = (delegated.structuredContent?.result as { id: string })
      .id;
    const allowed = await client.callTool({
      name: "submit_agent_input",
      arguments: await pending(delegatedId),
    });
    assert.notEqual(allowed.isError, true);
    await until(() => c.store.get(delegatedId, "local").status === "completed");
    assert.equal(
      JSON.parse(c.store.get(delegatedId, "local").result!.summary).approved,
      true,
    );
  } finally {
    await client.close();
    await cleanup();
  }
});
