import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startSchema, now } from "../src/core/model.js";
import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Auth } from "../src/server/auth.js";
import { Store } from "../src/core/store.js";
import { Control } from "../src/core/control.js";
import { Workspaces } from "../src/core/workspace.js";
import { FixtureProvider } from "../src/providers/fixture.js";
import { application } from "../src/server/app.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ModelChoice } from "../src/core/model.js";

// Panel tools return loosely shaped structured content; tests narrow each field.
const panel = (response: object) =>
  (response as { structuredContent?: unknown }).structuredContent as
    | {
        panel_scope?: unknown;
        panel_selection?: unknown;
        tasks?: unknown;
        result?: unknown;
        conversation_id?: unknown;
      }
    | undefined;
test("owner-scoped sessions, expiration, pruning and token comparison", () => {
  const auth = new Auth("private-token");
  assert.equal(auth.matches("private-token"), true);
  assert.equal(auth.matches("wrong"), false);
  assert.equal(auth.matches("private-taken"), false);
  const alice = auth.session("alice");
  const bob = auth.session("bob");
  assert.equal(auth.ownerFor(`other=value; ac_session=${alice}`), "alice");
  assert.equal(auth.ownerFor(`ac_session=${bob}; other=value`), "bob");
  assert.equal(auth.ownerFor(undefined), undefined);
  assert.equal(auth.ownerFor("ac_session=unknown"), undefined);
  auth.sessions.get(alice)!.expires = 0;
  assert.equal(auth.ownerFor(`ac_session=${alice}`), undefined);
  auth.prune();
  assert.equal(auth.sessions.has(alice), false);
  assert.equal(auth.sessions.has(bob), true);
  assert.equal(auth.ownerFor(`ac_session=${bob}`), "bob");
});
test("HTTP auth, CSRF, origin checks, MCP tools and UI resource metadata", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ac-http-")));
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
    dir,
  );
  const seedTask = (
    id: string,
    owner: string,
    conversation_id?: string,
    repository = dir,
  ) => {
    c.store.save({
      ...startSchema.parse({
        title: "Panel task",
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
      attempt: 0,
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
    "http://127.0.0.1:4317",
    resolve("dist/console.html"),
    undefined,
    resolve("dist/codex.html"),
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
    assert.deepEqual(
      client.getServerCapabilities()?.experimental?.[
        "codex/sandbox-state-meta"
      ],
      {},
    );
    assert.deepEqual(
      client.getServerCapabilities()?.experimental?.["openai/settings"],
      {
        readTool: "get_agent_settings",
        updateTool: "update_user_agent_settings",
      },
    );
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
    const opener = tools.tools.find(
      (t) => t.name === "open_codex_subagent_extension",
    )!;
    assert.equal(
      (opener._meta as any).ui.resourceUri,
      "ui://codex-subagent-extension/app-v6",
    );
    assert.deepEqual(opener._meta?.["openai/ui"], {
      entrypoints: [{ type: "thread" }],
      preferredModelDisplayMode: "inline",
    });
    const ui = await client.readResource({
      uri: (opener._meta as any).ui.resourceUri,
    });
    assert.equal(ui.contents[0].uri, "ui://codex-subagent-extension/app-v6");
    assert.equal(ui.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.ok("text" in ui.contents[0]);
    assert.deepEqual((ui.contents[0] as any)._meta["openai/ui"], {
      availableDisplayModes: ["inline", "fullscreen"],
      preferredDisplayMode: "inline",
    });
    const starter = tools.tools.find(
      (tool) => tool.name === "start_agent_task",
    )!;
    assert.equal(
      (starter._meta as any).ui.resourceUri,
      (opener._meta as any).ui.resourceUri,
    );
    assert.equal(
      (starter._meta as any)["openai/ui"].preferredModelDisplayMode,
      "inline",
    );
    assert.match(ui.contents[0].text, /<title>Delegated work<\/title>/);
    const standalone = await fetch(base + "/");
    assert.equal(standalone.status, 200);
    assert.match(
      await standalone.text(),
      /<title>Codex subagent extension<\/title>/,
    );
    assert.deepEqual((ui.contents[0] as any)._meta.ui.csp, {
      connectDomains: [],
      resourceDomains: [],
    });
    assert.deepEqual((ui.contents[0] as any)._meta["openai/widgetCSP"], {
      connect_domains: [],
      resource_domains: [],
    });
    assert.deepEqual(
      (tools.tools.find((t) => t.name === "list_agent_tasks")!._meta as any).ui
        .visibility,
      ["model", "app"],
    );
    const open = await client.callTool({
      name: "open_codex_subagent_extension",
      arguments: {},
    });
    assert.deepEqual(panel(open)?.panel_scope, {
      conversation_id: null,
    });
    assert.deepEqual(
      (panel(open)?.tasks as { id: string }[]).map((task) => task.id).sort(),
      ["current-thread", "other-project", "other-thread", "unscoped"],
    );
    const globalOpener = tools.tools.find(
      (tool) => tool.name === "open_codex_subagent_extension_global",
    )!;
    assert.ok(globalOpener);
    assert.deepEqual(globalOpener._meta?.ui, {
      resourceUri: (opener._meta as any).ui.resourceUri,
      visibility: ["app"],
    });
    assert.deepEqual(globalOpener._meta?.["openai/ui"], {
      entrypoints: [{ type: "global" }],
      preferredModelDisplayMode: "inline",
    });
    assert.deepEqual(globalOpener.inputSchema.properties, {});
    assert.equal(globalOpener.inputSchema.additionalProperties, false);
    assert.deepEqual(globalOpener.outputSchema, opener.outputSchema);
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
          "get_agent_panel_context",
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
            name === "get_agent_panel_context"
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
        name: "start_agent_task",
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
        tab: "activity",
      });
    };
    const globalOpen = await client.callTool({
      name: globalOpener.name,
      arguments: {},
      _meta: ambientMeta,
    });
    assert.equal(globalOpen.isError, undefined);
    assert.deepEqual(panel(globalOpen)?.panel_scope, {
      conversation_id: null,
    });
    assert.deepEqual(
      (panel(globalOpen)?.tasks as { id: string }[])
        .map((task) => task.id)
        .sort(),
      ["current-thread", "other-project", "other-thread", "unscoped"],
    );
    const globalContext = await client.callTool({
      name: "get_agent_panel_context",
      arguments: { conversation_id: null },
      _meta: ambientMeta,
    });
    assert.deepEqual((panel(globalContext)?.result as any).panel_scope, {
      conversation_id: null,
    });
    await checkSelectedTaskContext(client);
    const scopedOpen = await client.callTool({
      name: "open_codex_subagent_extension",
      arguments: { conversation_id: "conversation-a" },
    });
    assert.deepEqual(panel(scopedOpen)?.panel_scope, {
      conversation_id: "conversation-a",
      repository: dir,
      revision: "HEAD",
    });
    assert.deepEqual(
      (panel(scopedOpen)?.tasks as { id: string }[]).map((task) => task.id),
      ["current-thread"],
    );
    assert.equal(scopedOpen._meta?.conversation_id, "conversation-a");
    assert.equal(open._meta?.bootstrap, undefined);
    assert.equal(open._meta?.origin, undefined);
    const nativeOpen = await client.callTool({
      name: "open_codex_subagent_extension",
      arguments: {},
      _meta: { "openai/session": "conversation-a" },
    });
    assert.deepEqual(panel(nativeOpen)?.panel_scope, {
      conversation_id: "conversation-a",
      repository: dir,
      revision: "HEAD",
    });
    const nativeTasks = await client.callTool({
      name: "list_agent_tasks",
      arguments: {},
      _meta: { "openai/session": "conversation-a" },
    });
    assert.deepEqual(
      (panel(nativeTasks)?.result as { id: string }[]).map((task) => task.id),
      ["current-thread"],
    );
    const explicitTasks = await client.callTool({
      name: "list_agent_tasks",
      arguments: { conversation_id: "conversation-b" },
      _meta: { "openai/session": "conversation-a" },
    });
    assert.deepEqual(
      (panel(explicitTasks)?.result as { id: string }[]).map((task) => task.id),
      ["other-thread"],
    );
    const fromDirectory = await client.callTool({
      name: "open_codex_subagent_extension",
      arguments: { conversation_id: "first-use" },
      _meta: {
        "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(dir).href },
      },
    });
    assert.deepEqual(panel(fromDirectory)?.panel_scope, {
      conversation_id: "first-use",
      repository: dir,
      revision: "HEAD",
    });
    const started = await client.callTool({
      name: "start_agent_task",
      arguments: {
        title: "Review [input]",
        description: "Review [input]",
        provider: "fixture",
        repository: dir,
      },
      _meta: { threadId: "http-start" },
    });
    assert.equal(started.isError, undefined);
    const startedTask = panel(started)?.result as { id: string };
    assert.deepEqual(panel(started)?.panel_scope, {
      conversation_id: "http-start",
      repository: dir,
      revision: "HEAD",
    });
    assert.deepEqual(panel(started)?.panel_selection, {
      task_id: startedTask.id,
      tab: "activity",
    });
    assert.deepEqual(panel(started)?.tasks, [panel(started)?.result]);
    await checkGlobalCreation(client);
    await client.close();
    const stdio = new Client({ name: "stdio-test", version: "1.0.0" });
    try {
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
      assert.deepEqual(
        stdio.getServerCapabilities()?.experimental?.[
          "codex/sandbox-state-meta"
        ],
        {},
      );
      assert.deepEqual(
        (stdio.getServerCapabilities() as any)?.extensions?.["openai/settings"],
        {
          readTool: "get_agent_settings",
          updateTool: "update_user_agent_settings",
        },
      );
      assert.deepEqual(
        stdio.getServerCapabilities()?.experimental?.["openai/settings"],
        {
          readTool: "get_agent_settings",
          updateTool: "update_user_agent_settings",
        },
      );
      const nativeSettings = await stdio.callTool({
        name: "get_agent_settings",
        arguments: {},
      });
      assert.ok(!nativeSettings.isError);
      assert.equal(
        (nativeSettings.structuredContent as any).schema.type,
        "object",
      );
      assert.ok(
        Array.isArray((nativeSettings.structuredContent as any).layout),
      );
      assert.equal(
        (nativeSettings.structuredContent as any).values.default_model,
        "",
      );
      const nativeUpdated = await stdio.callTool({
        name: "update_agent_settings",
        arguments: {
          set: {
            default_model: "native-proxy-model",
            reviewer_default_reasoning_effort: "high",
          },
        },
      });
      assert.ok(!nativeUpdated.isError);
      assert.equal(
        (nativeUpdated.structuredContent as any).values.default_model,
        "native-proxy-model",
      );
      assert.equal(
        (nativeUpdated.structuredContent as any).values
          .reviewer_default_reasoning_effort,
        "high",
      );
      const nativeReadback = await stdio.callTool({
        name: "get_agent_settings",
        arguments: {},
      });
      assert.equal(
        (nativeReadback.structuredContent as any).values.default_model,
        "native-proxy-model",
      );
      const inventory = await stdio.listTools();
      assert.ok(inventory.tools.some((t) => t.name === "continue_agent_task"));
      const proxyOpener = inventory.tools.find(
        (tool) => tool.name === "open_codex_subagent_extension",
      )!;
      assert.ok(proxyOpener);
      assert.equal(
        (proxyOpener._meta as any).ui.resourceUri,
        "ui://codex-subagent-extension/app-v6",
      );
      assert.deepEqual(proxyOpener._meta, opener._meta);
      const proxyGlobalOpener = inventory.tools.find(
        (tool) => tool.name === globalOpener.name,
      )!;
      assert.ok(proxyGlobalOpener);
      assert.deepEqual(proxyGlobalOpener._meta, globalOpener._meta);
      assert.deepEqual(
        inventory.tools.find((tool) => tool.name === "start_agent_task")!._meta,
        starter._meta,
      );
      // The SDKs emit different JSON Schema draft identifiers for the same contract.
      const schemaShape = (schema: unknown) => {
        const { $schema: _draft, ...shape } = schema as Record<string, unknown>;
        return shape;
      };
      for (const name of ["get_agent_settings", "update_agent_settings"]) {
        const httpTool = tools.tools.find((tool) => tool.name === name)!;
        const stdioTool = inventory.tools.find((tool) => tool.name === name)!;
        assert.ok(
          httpTool.outputSchema,
          `${name} advertises an HTTP output schema`,
        );
        assert.ok(
          stdioTool.outputSchema,
          `${name} advertises a stdio output schema`,
        );
        assert.equal(httpTool.outputSchema.type, "object");
        assert.ok(httpTool.outputSchema.properties?.values);
        assert.deepEqual(
          schemaShape(stdioTool.outputSchema),
          schemaShape(httpTool.outputSchema),
        );
      }
      assert.deepEqual(
        schemaShape(proxyOpener.inputSchema),
        schemaShape(opener.inputSchema),
      );
      assert.deepEqual(
        schemaShape(proxyOpener.outputSchema),
        schemaShape(opener.outputSchema),
      );
      assert.deepEqual(proxyOpener.annotations, opener.annotations);
      assert.deepEqual(
        schemaShape(proxyGlobalOpener.inputSchema),
        schemaShape(globalOpener.inputSchema),
      );
      assert.deepEqual(
        schemaShape(proxyGlobalOpener.outputSchema),
        schemaShape(globalOpener.outputSchema),
      );
      assert.deepEqual(proxyGlobalOpener.annotations, globalOpener.annotations);
      assert.equal(proxyGlobalOpener.description, globalOpener.description);
      assert.equal(proxyOpener.description, opener.description);
      assert.equal(proxyOpener.annotations?.readOnlyHint, true);
      assert.deepEqual(
        (
          inventory.tools.find((tool) => tool.name === "list_agent_tasks")!
            ._meta as any
        ).ui.visibility,
        ["model", "app"],
      );
      const proxyUi = await stdio.readResource({
        uri: (proxyOpener._meta as any).ui.resourceUri,
      });
      assert.equal(
        proxyUi.contents[0].uri,
        "ui://codex-subagent-extension/app-v6",
      );
      assert.equal(proxyUi.contents[0].mimeType, "text/html;profile=mcp-app");
      assert.ok("text" in proxyUi.contents[0]);
      assert.match(proxyUi.contents[0].text, /<title>Delegated work<\/title>/);
      assert.deepEqual((proxyUi.contents[0] as any)._meta.ui.csp, {
        connectDomains: [],
        resourceDomains: [],
      });
      assert.deepEqual((proxyUi.contents[0] as any)._meta["openai/widgetCSP"], {
        connect_domains: [],
        resource_domains: [],
      });
      assert.deepEqual(proxyUi.contents, ui.contents);
      const unscopedProxyOpen = await stdio.callTool({
        name: "open_codex_subagent_extension",
        arguments: {},
      });
      assert.deepEqual(panel(unscopedProxyOpen)?.panel_scope, {
        conversation_id: null,
      });
      assert.equal(panel(unscopedProxyOpen)?.tasks, undefined);
      const globalProxyOpen = await stdio.callTool({
        name: globalOpener.name,
        arguments: {},
        _meta: ambientMeta,
      });
      assert.equal(globalProxyOpen.isError, undefined);
      assert.deepEqual(panel(globalProxyOpen)?.panel_scope, {
        conversation_id: null,
      });
      assert.equal(panel(globalProxyOpen)?.tasks, undefined);
      const globalProxyContext = await stdio.callTool({
        name: "get_agent_panel_context",
        arguments: { conversation_id: null },
        _meta: ambientMeta,
      });
      assert.deepEqual((panel(globalProxyContext)?.result as any).panel_scope, {
        conversation_id: null,
      });
      await checkSelectedTaskContext(stdio);
      const nativeProxyOpen = await stdio.callTool({
        name: "open_codex_subagent_extension",
        arguments: {},
        _meta: { "openai/session": "conversation-a" },
      });
      assert.deepEqual(panel(nativeProxyOpen)?.panel_scope, {
        conversation_id: "conversation-a",
        repository: dir,
        revision: "HEAD",
      });
      const nativeProxyTasks = await stdio.callTool({
        name: "list_agent_tasks",
        arguments: {},
        _meta: { "openai/session": "conversation-a" },
      });
      assert.deepEqual(
        (panel(nativeProxyTasks)?.result as { id: string }[]).map(
          (task) => task.id,
        ),
        ["current-thread"],
      );
      const proxyOpen = await stdio.callTool({
        name: "open_codex_subagent_extension",
        arguments: { conversation_id: "conversation-a" },
      });
      assert.deepEqual(panel(proxyOpen)?.panel_scope, {
        conversation_id: "conversation-a",
        repository: dir,
        revision: "HEAD",
      });
      assert.equal(panel(proxyOpen)?.conversation_id, "conversation-a");
      const proxyWorkers = await stdio.callTool({
        name: "list_available_workers",
        arguments: {},
      });
      const proxyFromDirectory = await stdio.callTool({
        name: "open_codex_subagent_extension",
        arguments: { conversation_id: "proxy-first-use" },
        _meta: {
          "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(dir).href },
        },
      });
      assert.deepEqual(panel(proxyFromDirectory)?.panel_scope, {
        conversation_id: "proxy-first-use",
        repository: dir,
        revision: "HEAD",
      });
      const proxyStarted = await stdio.callTool({
        name: "start_agent_task",
        arguments: {
          title: "Review [input]",
          description: "Review [input]",
          provider: "fixture",
          repository: dir,
        },
        _meta: { "openai/session": "stdio-start", threadId: "ignored-thread" },
      });
      assert.equal(proxyStarted.isError, false);
      const proxyTask = panel(proxyStarted)?.result as {
        id: string;
      };
      assert.deepEqual(panel(proxyStarted)?.panel_scope, {
        conversation_id: "stdio-start",
        repository: dir,
        revision: "HEAD",
      });
      assert.deepEqual(panel(proxyStarted)?.panel_selection, {
        task_id: proxyTask.id,
        tab: "activity",
      });
      assert.deepEqual(panel(proxyStarted)?.tasks, [
        panel(proxyStarted)?.result,
      ]);
      await checkGlobalCreation(stdio);
      assert.equal(proxyWorkers.isError, false);
      assert.ok(JSON.stringify(proxyWorkers.content).includes("fixture"));
    } finally {
      await stdio.close();
    }
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
    ...startSchema.parse({ title: "test", description: "test" }),
    id,
    title: "test",
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
  const provider = Object.assign(new FixtureProvider(), {
    models: async (): Promise<ModelChoice[]> => [
      {
        value: "default",
        displayName: "Fixture model",
        description: "Test catalog",
        supportedEffortLevels: ["low"],
      },
    ],
  });
  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["fixture", provider]]),
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
        updateTool: "update_user_agent_settings",
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
    assert.deepEqual(
      settings.json.result.structuredContent.schema.properties
        .fixture_default_model.enum,
      ["", "default"],
    );
    assert.deepEqual(
      settings.json.result.structuredContent.schema.properties
        .fixture_default_reasoning_effort.enum,
      ["default", "low"],
    );
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
    const opener = tools.json.result.tools.find(
      (t: any) => t.name === "open_codex_subagent_extension",
    );
    assert.ok(opener?._meta?.ui?.resourceUri);
    assert.deepEqual(
      tools.json.result.tools.find((t: any) => t.name === "list_agent_tasks")
        ._meta.ui.visibility,
      ["model", "app"],
    );
    const resource = await rpc("resources/read", {
      uri: opener._meta.ui.resourceUri,
    });
    assert.equal(
      resource.json.result.contents[0].mimeType,
      "text/html;profile=mcp-app",
    );
    assert.deepEqual(resource.json.result.contents[0]._meta.ui.csp, {
      connectDomains: [],
      resourceDomains: [],
    });
    assert.deepEqual(
      resource.json.result.contents[0]._meta["openai/widgetCSP"],
      {
        connect_domains: [],
        resource_domains: [],
      },
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
