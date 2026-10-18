import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TestContext } from "vitest";

import { FixtureProvider } from "../../../dev/service/fixture-provider.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { application } from "../../../src/service/platform/server/app.js";
import { Auth } from "../../../src/service/platform/server/auth.js";
import { startSchema } from "../../../src/shared/tasks/model.js";
import { now } from "../../../src/shared/time.js";
import { waitForListening } from "../../support/helpers.js";

// Panel tools return loosely shaped structured content; tests narrow each field.
export const panel = (response: object) =>
  (response as { structuredContent?: unknown }).structuredContent as
    | {
        panel_scope?: unknown;
        panel_selection?: unknown;
        tasks?: unknown;
        result?: unknown;
        conversation_id?: unknown;
      }
    | undefined;

export async function httpFixture(t: TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ac-http-")));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
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

  const c = new Control(
    new Store(join(dir, "test.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["fixture", new FixtureProvider()]]),
  );

  t.onTestFinished(() => c.close());

  const seedTask = (
    id: string,
    owner: string,
    conversation_id?: string,
    repository = dir,
  ) => {
    c.store.save({
      ...startSchema.parse({
        description: "Panel task",
        conversation_id,
        repository,
        revision: "HEAD",
      }),
      id,
      title: "Panel task",
      owner,
      status: "completed",
      created_at: now(),
      updated_at: now(),
      created_by: "user",
      instructions_sent: 0,
      pending_steers: [],
      queue: [],
      turn: 0,
      runtime_ms: 0,
      instructions: [],
    });
  };

  seedTask("current-thread", "local", "conversation-a");
  seedTask("other-thread", "local", "conversation-b");
  execFileSync("git", ["init", "-q", join(dir, "another-project")]);

  seedTask(
    "other-project",
    "local",
    "conversation-c",
    join(dir, "another-project"),
  );

  seedTask("unscoped", "local");
  seedTask("private-task", "other-owner", "conversation-a");
  const auth = new Auth("private-token");

  const server = application(
    c,
    auth,
    "http://127.0.0.1:17317",
    resolve("dist/app.html"),
    resolve("dist/app.html"),
  ).listen(0, "127.0.0.1");

  t.onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  await waitForListening(server);
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

  const client = new Client({ name: "test", version: "1.0.0" });
  t.onTestFinished(() => client.close());

  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { Authorization: "Bearer private-token" } },
    }),
  );

  const tools = await client.listTools();

  const opener = tools.tools.find(
    (t) => t.name === "open_codex_subagent_extension",
  )!;

  const ui = await client.readResource({
    uri: (opener._meta as any).ui.resourceUri,
  });

  const globalOpener = tools.tools.find(
    (tool) => tool.name === "app_open_codex_subagent_extension_global",
  )!;

  const ambientMeta = {
    threadId: "ambient-thread",
    "openai/session": "conversation-a",
    "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(dir).href },
  };

  const checkSelectedTaskContext = async (transportClient: Client) => {
    for (const task_id of ["unscoped", "other-thread", "other-project"]) {
      const task = c.store.get(task_id, "local");

      for (const name of [
        "open_codex_subagent_extension",
        "get_panel_context",
      ]) {
        const selected = await transportClient.callTool({
          name,
          arguments: { task_id },
          _meta: ambientMeta,
        });

        assert.notEqual(
          selected.isError,
          true,
          JSON.stringify(selected.content),
        );

        const context =
          name === "get_panel_context"
            ? (panel(selected)?.result as any)
            : selected.structuredContent;

        assert.deepEqual(context?.panel_scope, {
          conversation_id: task.conversation_id ?? null,
          repository: task.repository,
          revision: task.revision,
        });

        assert.equal(context?.panel_selection.task_id, task_id);

        const conflict = await transportClient.callTool({
          name,
          arguments: { task_id, conversation_id: "explicit-conflict" },
          _meta: ambientMeta,
        });

        assert.equal(conflict.isError, true);

        assert.match(
          JSON.stringify(conflict.content),
          /different conversation/,
        );
      }
    }
  };

  const checkGlobalCreation = async (transportClient: Client) => {
    const started = await transportClient.callTool({
      name: "start_task",
      arguments: {
        title: "Global review [input]",
        description: "Global review [input]",
        provider: "fixture",
        repository: dir,
        conversation_id: null,
      },
      _meta: ambientMeta,
    });

    assert.notEqual(started.isError, true);

    const task = panel(started)?.result as {
      id: string;
      conversation_id?: string;
    };

    assert.equal(task.conversation_id, undefined);
    assert.equal(c.store.get(task.id, "local").conversation_id, undefined);

    assert.deepEqual(panel(started)?.panel_scope, {
      conversation_id: null,
      repository: dir,
      revision: "HEAD",
    });

    assert.deepEqual(panel(started)?.panel_selection, {
      task_id: task.id,
      tab: "chat",
    });
  };

  return {
    dir,
    c,
    server,
    base,
    post,
    client,
    tools,
    opener,
    ui,
    globalOpener,
    ambientMeta,
    checkSelectedTaskContext,
    checkGlobalCreation,
  };
}
