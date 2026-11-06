import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "vitest";

import { FixtureProvider } from "../../../dev/service/fixture-provider.js";
import {
  type RunContext,
  type TurnOutput,
} from "../../../src/service/features/providers/types.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { application } from "../../../src/service/platform/server/app.js";
import { Auth } from "../../../src/service/platform/server/auth.js";
import { waitForListening } from "../../support/helpers.js";
import { copyCommittedRepository } from "../../support/repository-test-harness.js";

class PermissionProvider extends FixtureProvider {
  override async run(ctx: RunContext): Promise<TurnOutput> {
    const answer = await ctx.input("Bash", { command: "pwd" }, ctx.signal);

    return {
      reply: JSON.stringify(answer),
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
  await copyCommittedRepository(dir);

  const html = join(dir, "app.html");
  await writeFile(html, "<!doctype html><title>Approval test</title>");

  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["fixture", new PermissionProvider()]]),
  );

  const app = application(
    c,
    new Auth("test-token"),
    "http://127.0.0.1:17317",
    html,
  );

  const server = app.listen(0, "127.0.0.1");
  await waitForListening(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const bearer = {
    Authorization: "Bearer test-token",
    "X-Subagent-Extension-For-Codex": "1",
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

  const [session] = login.headers.get("set-cookie")!.split(";");

  assert.ok(session);

  const cookie = { Cookie: session, "X-Subagent-Extension-For-Codex": "1" };

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
    const change = { set: { approvals: { execution_mode: "parent_agent" } } };
    const blocked = await post("/api/tools/update_settings", change);
    assert.equal(blocked.status, 400);

    assert.match((await blocked.json()).error, /requires a user decision/);

    assert.equal(
      (await post("/api/tools/update_settings", change, cookie)).status,
      200,
    );

    assert.equal(
      c.settings.values("local").approvals.execution_mode,
      "parent_agent",
    );

    assert.equal(
      (
        await post(
          "/api/tools/update_settings",
          { set: { approvals: { execution_mode: "ask_user" } } },
          cookie,
        )
      ).status,
      200,
    );

    const started = await post("/api/tools/start_task", start);
    assert.equal(started.status, 200);
    const id = (await started.json()).result.id;
    const approval = await pending(id);

    for (const approved of [true, false]) {
      const decision = await post("/api/tools/submit_input", {
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
      (await post("/api/tools/submit_input", approval, cookie)).status,
      200,
    );

    await until(() => c.store.get(id, "local").status === "completed");

    assert.equal(
      JSON.parse(String(c.store.latestEvent(id, "agent.reply")!.data.text))
        .approved,
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
        await post("/api/user-tools/app_update_settings", {
          set: { approvals: { execution_mode: "deny" } },
        })
      ).status,
      200,
    );

    assert.equal(c.settings.values("local").approvals.execution_mode, "deny");

    const restricted = await post("/api/tools/start_task", {
      ...start,
      approval_mode: "ask_user",
    });

    assert.equal(restricted.status, 400);

    const started = await post("/api/user-tools/app_start_task", {
      ...start,
      approval_mode: "ask_user",
    });

    assert.equal(started.status, 200);
    const id = (await started.json()).result.id;
    const approval = await pending(id);

    assert.equal(
      (await post("/api/tools/app_submit_input", approval)).status,
      400,
    );

    assert.equal(
      (await post("/api/user-tools/app_submit_input", approval)).status,
      200,
    );

    await until(() => c.store.get(id, "local").status === "completed");

    assert.equal(
      JSON.parse(String(c.store.latestEvent(id, "agent.reply")!.data.text))
        .approved,
      true,
    );

    assert.equal(
      (
        await post("/api/user-tools/update_settings", {
          set: { approvals: { execution_mode: "auto_approve" } },
        })
      ).status,
      400,
    );

    assert.equal(
      (await post("/api/user-tools/app_update_settings", {}, {})).status,
      401,
    );
  } finally {
    await cleanup();
  }
});

test("MCP advertises app-only aliases and lets the parent agent answer delegated approvals", async () => {
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
      "app_start_task",
      "app_submit_input",
      "app_update_settings",
      "app_register_project",
      "app_browse_project",
      "app_remove_worktree",
      "app_delete_tasks",
      "app_delete_branch",
    ]) {
      const tool = tools.find((entry) => entry.name === name);
      assert.ok(tool, `${name} must be available to the app`);
      assert.deepEqual((tool._meta as any).ui.visibility, ["app"]);
    }

    // The app_ prefix marks exactly the tools hidden from the model. MCP Apps
    // shows tools without a visibility to both.
    for (const tool of tools) {
      const visibility: string[] = (tool._meta as any)?.ui?.visibility ?? [
        "model",
        "app",
      ];

      assert.equal(
        tool.name.startsWith("app_"),
        !visibility.includes("model"),
        tool.name,
      );
    }

    assert.deepEqual(
      (tools.find((entry) => entry.name === "submit_input")!._meta as any).ui
        .visibility,
      ["model", "app"],
    );

    assert.equal(
      (
        await post(
          "/api/tools/update_settings",
          { set: { approvals: { execution_mode: "parent_agent" } } },
          cookie,
        )
      ).status,
      200,
    );

    const delegated = await client.callTool({
      name: "start_task",
      arguments: start,
    });

    const delegatedId = (
      delegated.structuredContent as { result: { id: string } }
    ).result.id;

    const allowed = await client.callTool({
      name: "submit_input",
      arguments: await pending(delegatedId),
    });

    assert.notEqual(allowed.isError, true);
    await until(() => c.store.get(delegatedId, "local").status === "completed");

    assert.equal(
      JSON.parse(
        String(c.store.latestEvent(delegatedId, "agent.reply")!.data.text),
      ).approved,
      true,
    );
  } finally {
    await client.close();
    await cleanup();
  }
});

test("HTTP and MCP mark only send failures confirmed before acceptance", async () => {
  const { c, base, post, start, pending, cleanup } = await setup();
  const client = new Client({ name: "send-rejection-test", version: "1.0.0" });
  const interrupt = c.interrupt;

  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer test-token" } },
      }),
    );

    const started = await post("/api/tools/start_task", start);
    const id = (await started.json()).result.id as string;
    await pending(id);

    c.interrupt = async () => {
      throw new Error("Shutdown failed");
    };

    const cases = [
      {
        label: "rejected",
        task_id: id,
        delivery: "steer",
        rejected: true,
        message: /waiting for input/,
      },
      {
        label: "unknown-task",
        task_id: "missing",
        delivery: "queue",
        rejected: false,
        message: /Task not found/,
      },
      {
        label: "accepted",
        task_id: id,
        delivery: "interrupt",
        rejected: false,
        message: /Shutdown failed/,
      },
    ];

    for (const scenario of cases) {
      const args = {
        task_id: scenario.task_id,
        delivery: scenario.delivery,
        message: "Next",
        request_id: `http-${scenario.label}`,
      };

      const response = await post("/api/tools/send_message", args);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(scenario.message);
      expect(body.send_rejected).toBe(scenario.rejected ? true : undefined);

      const result = await client.callTool({
        name: "send_message",
        arguments: { ...args, request_id: `mcp-${scenario.label}` },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: body.error }]);

      expect(result._meta?.send_rejected).toBe(
        scenario.rejected ? true : undefined,
      );
    }

    expect(c.store.get(id, "local").pending_steers).toHaveLength(2);
  } finally {
    c.interrupt = interrupt;
    await client.close();
    await cleanup();
  }
});
