import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeEach, describe, test } from "vitest";

import { FixtureProvider } from "../../../dev/service/fixture-provider.js";
import { Projects } from "../../../src/service/features/projects/projects.js";
import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { application } from "../../../src/service/platform/server/app.js";
import { Auth } from "../../../src/service/platform/server/auth.js";
import { PARENT_DELEGATION_PROTOCOL } from "../../../src/shared/tasks/conversation/parent-protocol.js";
import { startSchema } from "../../../src/shared/tasks/model.js";
import { now } from "../../../src/shared/time.js";
import { waitForListening } from "../../support/helpers.js";
import { httpFixture, panel } from "./http-test-harness.js";

describe("HTTP auth, CSRF, origin checks, MCP tools and UI resource metadata", () => {
  let fixture: Awaited<ReturnType<typeof httpFixture>>;

  beforeEach(async (t) => {
    fixture = await httpFixture(t);
  });

  test("auth, CSRF and origin checks", async () => {
    const { post } = fixture;
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
    const [cookie] = login.headers.get("set-cookie")!.split(";");

    assert.ok(cookie);
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
  });

  test("MCP tools and UI resource metadata", async () => {
    const { client, tools, opener, ui, base } = fixture;
    assert.equal(client.getServerVersion()?.name, "codex-subagent-extension");
    assert.ok(client.getInstructions()?.includes(PARENT_DELEGATION_PROTOCOL));

    assert.deepEqual(
      client.getServerCapabilities()?.experimental?.[
        "codex/sandbox-state-meta"
      ],
      {},
    );

    // Settings live in the panel only; hosts get no native settings capability.
    assert.equal(
      client.getServerCapabilities()?.experimental?.["openai/settings"],
      undefined,
    );

    assert.ok(tools.tools.some((t) => t.name === "start_agent_task"));

    const ackTool = tools.tools.find(
      (tool) => tool.name === "ack_agent_message",
    );

    assert.ok(ackTool);
    assert.deepEqual((ackTool._meta as any).ui.visibility, ["model", "app"]);

    const mentionTool = tools.tools.find(
      (tool) => tool.name === "search_mentions",
    );

    assert.ok(mentionTool);
    assert.equal(mentionTool.title, "Choose a worker");
    assert.equal(mentionTool._meta?.connector_name, "Delegate to Claude");

    assert.deepEqual((mentionTool._meta as any)["openai/extensions"], {
      "mentions/search": {},
    });

    assert.deepEqual((mentionTool._meta as any).ui.visibility, ["app"]);

    const mentionResults = await client.callTool({
      name: "search_mentions",
      arguments: { query: "claude" },
    });

    assert.equal(mentionResults.isError, undefined);
    assert.deepEqual(mentionResults.structuredContent, { items: [] });

    assert.ok(
      tools.tools.some((t) => t.name === "open_codex_subagent_extension"),
    );

    const workers = await client.callTool({
      name: "list_available_workers",
      arguments: {},
    });

    assert.equal(workers.isError, undefined);

    assert.equal(opener.title, "Delegated Work");

    for (const name of [
      "open_codex_subagent_extension",
      "wait_user_agent_updates",
    ]) {
      assert.equal(
        tools.tools.find((tool) => tool.name === name)?.annotations
          ?.readOnlyHint,
        true,
        name,
      );
    }

    for (const name of ["get_agent_settings", "update_agent_settings"]) {
      assert.ok(
        tools.tools.find((tool) => tool.name === name)?.outputSchema?.properties
          ?.values,
        `${name} advertises its settings output schema`,
      );
    }

    assert.equal(
      (opener._meta as any).ui.resourceUri,
      "ui://codex-subagent-extension/app-v6",
    );

    const resources = await client.listResources();

    assert.ok(
      resources.resources.some(
        (resource) =>
          resource.name === "Delegated Work" &&
          resource.uri === "ui://codex-subagent-extension/app-v6",
      ),
    );

    assert.ok(
      resources.resources.some(
        (resource) =>
          resource.uri === "codex-subagent-extension://providers/claude",
      ),
    );

    const mentionResource = await client.readResource({
      uri: "codex-subagent-extension://providers/claude",
    });

    const mentionContent = mentionResource.contents[0];
    assert.ok(mentionContent && "text" in mentionContent);
    assert.match(mentionContent.text, /Claude/);

    assert.deepEqual(
      opener.icons?.map((icon) => icon.theme),
      ["light", "dark"],
    );

    for (const [index, color] of ["#000000", "#ffffff"].entries()) {
      const icon: NonNullable<typeof opener.icons>[number] | undefined =
        opener.icons?.[index];

      assert.ok(icon);
      assert.equal(icon.mimeType, "image/svg+xml");
      assert.deepEqual(icon.sizes, ["any"]);
      assert.match(icon.src, /^data:image\/svg\+xml;base64,/);

      assert.match(
        Buffer.from(
          icon.src.slice("data:image/svg+xml;base64,".length),
          "base64",
        ).toString("utf8"),
        new RegExp(`stroke="${color}"`),
      );
    }

    assert.deepEqual(opener._meta?.["openai/ui"], {
      entrypoints: [{ type: "thread" }],
      preferredModelDisplayMode: "inline",
    });

    const [uiContent] = ui.contents;

    assert.ok(uiContent);

    assert.equal(uiContent.uri, "ui://codex-subagent-extension/app-v6");
    assert.equal(uiContent.mimeType, "text/html;profile=mcp-app");
    assert.ok("text" in uiContent);

    assert.deepEqual((uiContent as any)._meta["openai/ui"], {
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

    assert.match(uiContent.text, /<title>Delegated Work<\/title>/);
    const standalone = await fetch(base + "/");
    assert.equal(standalone.status, 200);

    const standaloneHtml = await standalone.text();
    assert.match(standaloneHtml, /<title>Delegated Work<\/title>/);

    assert.ok(
      standaloneHtml.includes(
        'window.CODEX_SUBAGENT_EXTENSION_ORIGIN = "http://127.0.0.1:17317"',
      ),
    );

    // Environment detection must retain its sentinel after the template is injected.
    assert.equal(standaloneHtml.split("__API_ORIGIN__").length - 1, 1);
    assert.equal(uiContent.text.split("__API_ORIGIN__").length - 1, 2);

    assert.deepEqual((uiContent as any)._meta.ui.csp, {
      connectDomains: [],
      resourceDomains: [],
    });

    assert.deepEqual((uiContent as any)._meta["openai/widgetCSP"], {
      connect_domains: [],
      resource_domains: [],
    });

    assert.deepEqual(
      (tools.tools.find((t) => t.name === "list_agent_tasks")!._meta as any).ui
        .visibility,
      ["model", "app"],
    );
  });

  test("panel scope follows explicit and host context", async () => {
    const {
      client,
      opener,
      globalOpener,
      ambientMeta,
      checkSelectedTaskContext,
      dir,
    } = fixture;

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

    assert.ok(globalOpener);
    assert.equal(globalOpener.title, "Delegated Work");
    assert.deepEqual(globalOpener.icons, opener.icons);

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
  });

  test("task start returns its panel selection and global scope", async () => {
    const { client, checkGlobalCreation, dir } = fixture;

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
      tab: "chat",
    });

    assert.deepEqual(panel(started)?.tasks, [panel(started)?.result]);
    await checkGlobalCreation(client);
  });

  test("stdio preserves HTTP metadata, scope and task creation behavior", async () => {
    const {
      base,
      tools,
      opener,
      ui,
      globalOpener,
      ambientMeta,
      checkSelectedTaskContext,
      checkGlobalCreation,
      dir,
    } = fixture;

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
            CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE: "0",
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

      assert.equal(
        (stdio.getServerCapabilities() as any)?.extensions?.["openai/settings"],
        undefined,
      );

      assert.equal(
        stdio.getServerCapabilities()?.experimental?.["openai/settings"],
        undefined,
      );

      assert.ok(stdio.getInstructions()?.includes(PARENT_DELEGATION_PROTOCOL));
      const stdioTools = await stdio.listTools();

      // The SDKs emit different JSON Schema draft identifiers for the same contract.
      const schemaShape = (schema: unknown) => {
        if (!schema) return schema;
        const { $schema: _draft, ...shape } = schema as Record<string, unknown>;

        return shape;
      };

      // Icons and task execution support differ between the two SDK servers.
      const definitionsByName = (list: typeof tools) =>
        Object.fromEntries(
          list.tools.map((tool) => [
            tool.name,
            {
              title: tool.title,
              description: tool.description,
              annotations: tool.annotations,
              _meta: tool._meta,
              inputSchema: schemaShape(tool.inputSchema),
              outputSchema: schemaShape(tool.outputSchema),
            },
          ]),
        );

      // The proxy advertises the service's tool contract: names, metadata,
      // schemas, annotations and descriptions.
      assert.deepEqual(definitionsByName(stdioTools), definitionsByName(tools));

      const settingsRead = await stdio.callTool({
        name: "get_agent_settings",
        arguments: {},
      });

      assert.ok(!settingsRead.isError);

      assert.equal(
        (settingsRead.structuredContent as any).values.default_model,
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

      const proxyMentionResults = await stdio.callTool({
        name: "search_mentions",
        arguments: { query: "claude" },
      });

      assert.equal(proxyMentionResults.isError, undefined);
      assert.deepEqual(proxyMentionResults.structuredContent, { items: [] });

      const proxyMentionResource = await stdio.readResource({
        uri: "codex-subagent-extension://providers/claude",
      });

      const proxyMentionContent = proxyMentionResource.contents[0];
      assert.ok(proxyMentionContent && "text" in proxyMentionContent);
      assert.match(proxyMentionContent.text, /Claude/);

      const proxyUi = await stdio.readResource({
        uri: (opener._meta as any).ui.resourceUri,
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
        tab: "chat",
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
  });
});

/** A service with projects enabled, serving the console on a local port. */
async function changeService(prefix: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const repository = join(dir, "repo");
  execFileSync("git", ["init", "-q", repository]);

  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map(),
  );

  c.projects = new Projects(c.store.database, c.workspaces, () =>
    c.store.projectsChanged(),
  );

  const auth = new Auth("token");

  const server = application(
    c,
    auth,
    "http://127.0.0.1:17317",
    resolve("dist/app.html"),
  ).listen(0, "127.0.0.1");

  await waitForListening(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const task = (id: string, owner: string) => ({
    ...startSchema.parse({ repository, description: "test" }),
    id,
    title: "test",
    owner,
    status: "completed" as const,
    created_at: now(),
    updated_at: now(),
    created_by: "user" as const,
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 0,
    runtime_ms: 0,
    instructions: [],
  });

  // Calls a user tool as the console does, with the owner's session cookie.
  const userTool = async (owner: string, name: string, args: object) => {
    const response = await fetch(`${base}/api/user-tools/${name}`, {
      method: "POST",
      headers: {
        Cookie: `ac_session=${auth.session(owner)}`,
        "Content-Type": "application/json",
        "X-Codex-Subagent-Extension": "1",
      },
      body: JSON.stringify(args),
    });

    const body = (await response.json()) as {
      result?: unknown;
      error?: string;
    };

    assert.equal(response.status, 200, `${name}: ${body.error}`);

    return body.result;
  };

  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await c.close();
  };

  return { c, auth, base, repository, task, userTool, close };
}

/** Polls until `ready` holds, so tests can wait on listener bookkeeping. */
async function eventually(ready: () => boolean) {
  for (let i = 0; i < 300 && !ready(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.ok(ready());
}

/** An open console event stream and a reader that consumes it. */
async function eventStream(base: string, headers: Record<string, string>) {
  const abort = new AbortController();

  const response = await fetch(base + "/api/events", {
    headers,
    signal: abort.signal,
  });

  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  // Reads through `text`, returning it and what came before; keeps the rest.
  const until = async (text: string) => {
    while (!buffered.includes(text)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`Stream ended before ${text}`);
      buffered += decoder.decode(value);
    }

    const end = buffered.indexOf(text) + text.length;
    const read = buffered.slice(0, end);
    buffered = buffered.slice(end);

    return read;
  };

  const close = async () => {
    abort.abort();
    await reader.cancel().catch(() => {});
  };

  return { until, close };
}

const changeCount = (text: string) => text.split("event: change").length - 1;

test("SSE requires authentication, streams each owner's revision on its changes and drafts, replays no events and releases its listeners", async () => {
  const { c, auth, base, repository, task, userTool, close } =
    await changeService("ac-sse-");

  const a = task("a", "local"),
    b = task("b", "other");

  c.store.save(a);
  c.store.save(b);
  c.store.eventOpaque(a, "test.first");
  c.store.eventOpaque(b, "test.secret");
  // A client that connects mid-message gets the draft so far.
  c.drafts.append("local", "a", "msg_a", "Hel");
  c.drafts.append("other", "b", "msg_b", "secret draft");

  try {
    assert.equal((await fetch(base + "/api/events")).status, 401);

    const local = await eventStream(base, { Authorization: "Bearer token" });

    const other = await eventStream(base, {
      Cookie: `ac_session=${auth.session("other")}`,
    });

    const change = (owner = "local") =>
      `event: change\ndata: ${c.store.revision(owner)}\n\n`;

    const initial = await local.until(change());
    await other.until(change("other"));

    await local.until(
      'event: delta\ndata: {"task_id":"a","message_id":"msg_a","text":"Hel","offset":0}\n\n',
    );

    // Each write, deletion and project change sends the revision again.
    c.store.eventOpaque(a, "test.live");
    const afterEvent = await local.until(change());

    await userTool("local", "register_user_agent_project", { repository });
    const afterProject = await local.until(change());
    // The project list is shared, so the other owner hears of it too, and of
    // nothing in between: the local write sent it no change.
    assert.equal(changeCount(await other.until(change("other"))), 1);

    c.store.delete(a.id, "local");
    const afterDelete = await local.until(change());

    const revisions = [initial, afterEvent, afterProject, afterDelete].map(
      (text) => /event: change\ndata: (.+)\n/.exec(text)?.[1],
    );

    assert.equal(new Set(revisions).size, 4);

    // Another owner's writes reach only its stream; a draft still streams.
    c.store.eventOpaque(b, "test.secret_live");
    assert.equal(changeCount(await other.until(change("other"))), 1);
    c.drafts.append("local", "x", "msg_x", "lo");

    const delta = await local.until(
      'event: delta\ndata: {"task_id":"x","message_id":"msg_x","offset":0,"text":"lo"}\n\n',
    );

    assert.ok(!delta.includes("event: change"));

    const streamed = [
      initial,
      afterEvent,
      afterProject,
      afterDelete,
      delta,
    ].join("");

    assert.ok(!streamed.includes("secret"));
    assert.ok(!streamed.includes("test."));
    assert.ok(!streamed.includes("id:"));

    // Disconnected streams stop listening, so reconnects don't accumulate.
    await local.close();
    await other.close();

    await eventually(
      () =>
        c.store.bus.listenerCount("change") === 0 &&
        c.store.bus.listenerCount("draft") === 0,
    );
  } finally {
    await close();
  }
});

test("a held update wait on the user-tools route returns the new revision when a task is deleted", async () => {
  const { c, task, userTool, close } = await changeService("ac-wait-");
  c.store.save(task("a", "local"));

  try {
    const before = c.store.revision("local");

    const waiting = userTool("local", "wait_user_agent_updates", {
      after: before,
      wait_ms: 25_000,
    });

    // If an assertion fails first, closing the server rejects the wait.
    waiting.catch(() => {});

    // The wait is held once it listens for changes.
    await eventually(() => c.store.bus.listenerCount("change") === 1);

    const deleting = Date.now();

    assert.deepEqual(
      await userTool("local", "delete_user_agent_task", { task_id: "a" }),
      { status: "deleted" },
    );

    const { revision } = (await waiting) as { revision: string };
    // Woken by the deletion, well before its 25 s wait would end.
    assert.ok(Date.now() - deleting < 10_000);
    assert.notEqual(revision, before);
    assert.equal(revision, c.store.revision("local"));
  } finally {
    await close();
  }
});

test("MCP 2.0 serves tools/resources without webhook capabilities on the authenticated endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ac-modern-"));

  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([["fixture", new FixtureProvider()]]),
  );

  const app = application(
    c,
    new Auth("token"),
    "http://127.0.0.1:17317",
    resolve("dist/app.html"),
  );

  const server = app.listen(0, "127.0.0.1");
  await waitForListening(server);
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
    assert.equal(discovery.json.result.capabilities.events, undefined);
    assert.ok(discovery.json.result.capabilities.tools);
    assert.ok(discovery.json.result.capabilities.resources);

    assert.equal(
      discovery.json.result.capabilities.extensions?.["openai/settings"],
      undefined,
    );

    assert.ok(discovery.json.result.supportedVersions.includes("2026-07-28"));

    for (const method of [
      "events/list",
      "events/subscribe",
      "events/unsubscribe",
    ]) {
      const rejected = await rpc(method);
      assert.equal(rejected.json.error.code, -32601);
    }

    const tools = await rpc("tools/list");

    const settings = await rpc("tools/call", {
      name: "get_agent_settings",
      arguments: {},
    });

    assert.equal(
      settings.json.result.structuredContent.values.default_provider,
      "fixture",
    );

    const updated = await rpc("tools/call", {
      name: "update_agent_settings",
      arguments: { set: { max_cost_usd: 2, use_cost_budget: true } },
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

    const resource = await rpc("resources/read", {
      uri: opener._meta.ui.resourceUri,
    });

    assert.equal(
      resource.json.result.contents[0].mimeType,
      "text/html;profile=mcp-app",
    );
  } finally {
    await app.locals.closeMcp();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await c.close();
  }
});
