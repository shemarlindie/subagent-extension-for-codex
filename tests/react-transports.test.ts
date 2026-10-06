import assert from "node:assert/strict";

import { test, vi } from "vitest";

import type { TransportEvents } from "../ui/core/types";
import { ConsoleTransport } from "../ui/transports/console";
import { HostTransport } from "../ui/transports/host";

function callbacks() {
  const statuses: string[] = [];
  const scopes: unknown[] = [];
  const hosts: unknown[] = [];
  let refreshes = 0,
    logins = 0,
    teardowns = 0;

  const events: TransportEvents = {
    scope: (scope) => {
      scopes.push(scope);
    },
    host: (host) => {
      hosts.push(host);
    },
    refresh: () => {
      refreshes++;
    },
    login: () => {
      logins++;
    },
    teardown: () => {
      teardowns++;
    },
    status: (status) => {
      statuses.push(status);
    },
  };

  return {
    events,
    statuses,
    scopes,
    hosts,
    counts: () => ({ refreshes, logins, teardowns }),
  };
}

class FakeStream {
  onopen?: () => void;
  onerror?: () => void;
  activity?: () => void;
  closes = 0;
  addEventListener(name: string, listener: () => void) {
    assert.equal(name, "activity");
    this.activity = listener;
  }

  close() {
    this.closes++;
  }
}

test("console requests use browser credentials and required headers for tools and login", async () => {
  const calls: { url: string; options: RequestInit }[] = [];

  const request = (async (
    url: string | URL | Request,
    options: RequestInit,
  ) => {
    calls.push({ url: String(url), options });

    return Response.json({ result: { ok: true } });
  }) as typeof fetch;

  const transport = new ConsoleTransport("https://console.example", request);
  const { events } = callbacks();
  await transport.connect(events);

  assert.deepEqual(
    await transport.tool("list_agent_tasks", { conversation_id: null }),
    { ok: true },
  );

  await transport.login("local-token");

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://console.example/api/tools/list_agent_tasks",
      "https://console.example/api/login",
    ],
  );

  for (const { options } of calls) {
    assert.equal(options.credentials, "include");
    assert.equal(options.method, "POST");

    assert.deepEqual(options.headers, {
      "Content-Type": "application/json",
      "X-Codex-Subagent-Extension": "1",
    });
  }

  assert.deepEqual(JSON.parse(calls[0].options.body as string), {
    conversation_id: null,
  });

  assert.deepEqual(JSON.parse(calls[1].options.body as string), {
    token: "local-token",
  });

  transport.dispose();
  await assert.rejects(transport.tool("list_agent_tasks"), /closed/);
  assert.equal(calls.length, 2);
});

test("console authentication failure requests login and server failures retain their message", async () => {
  let response = new Response(null, { status: 401 });

  const transport = new ConsoleTransport(
    "",
    (async () => response) as typeof fetch,
  );

  const observed = callbacks();
  await transport.connect(observed.events);

  await assert.rejects(
    transport.tool("list_agent_tasks"),
    /Connect the console/,
  );

  assert.equal(observed.counts().logins, 1);
  response = Response.json({ error: "Project unavailable" }, { status: 500 });

  await assert.rejects(
    transport.tool("list_agent_projects"),
    /Project unavailable/,
  );

  transport.dispose();
});

test("console SSE coalesces activity refreshes and disposal cancels pending refreshes", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const streams: FakeStream[] = [];
  const urls: string[] = [];

  const transport = new ConsoleTransport(
    "https://console.example",
    fetch,
    (url) => {
      urls.push(url);
      const stream = new FakeStream();
      streams.push(stream);

      return stream as unknown as EventSource;
    },
  );

  const observed = callbacks();
  await transport.connect(observed.events);
  transport.watch();
  assert.deepEqual(urls, ["https://console.example/api/events"]);
  streams[0].onopen?.();
  streams[0].onerror?.();
  assert.deepEqual(observed.statuses, ["● Live", "Reconnecting…"]);
  streams[0].activity?.();
  vi.advanceTimersByTime(50);
  streams[0].activity?.();
  vi.advanceTimersByTime(99);
  assert.equal(observed.counts().refreshes, 0);
  vi.advanceTimersByTime(1);
  assert.equal(observed.counts().refreshes, 1);
  transport.watch();
  assert.equal(streams[0].closes, 1);
  streams[1].activity?.();
  transport.dispose();
  vi.advanceTimersByTime(1000);
  assert.equal(streams[1].closes, 1);
  assert.equal(observed.counts().refreshes, 1);
  transport.watch();
  assert.equal(streams.length, 2);
});

function hostApp() {
  const calls: unknown[] = [];
  const toolOptions: unknown[] = [];
  let response: unknown = { structuredContent: { result: ["task"] } };
  let downloadDeclined = false;

  const app = {
    ontoolresult: undefined as any,
    onhostcontextchanged: undefined as any,
    onteardown: undefined as any,
    connect: async () => {},
    getHostCapabilities: () => ({
      serverTools: {},
      message: { text: true },
      updateModelContext: { structuredContent: true },
    }),
    getHostContext: () => ({
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    }),
    callServerTool: async (args: unknown, options?: unknown) => {
      calls.push(args);
      toolOptions.push(options);

      return response;
    },
    sendMessage: async (args: unknown) => {
      calls.push(args);

      return {};
    },
    updateModelContext: async (args: unknown) => {
      calls.push(args);
    },
    requestDisplayMode: async (args: unknown) => {
      calls.push(args);
    },
    downloadFile: async (args: unknown) => {
      calls.push(args);

      return { isError: downloadDeclined };
    },
  };

  return {
    app,
    calls,
    toolOptions,
    declineDownloads: () => {
      downloadDeclined = true;
    },
    respond: (value: unknown) => {
      response = value;
    },
  };
}

test("host folder browsing allows native interaction time while ordinary tools use default timeout", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);
  fake.respond({ structuredContent: { result: { repository: null } } });

  assert.deepEqual(await transport.tool("browse_user_agent_project"), {
    repository: null,
  });

  assert.deepEqual(fake.calls[0], {
    name: "browse_user_agent_project",
    arguments: {},
  });

  assert.deepEqual(fake.toolOptions[0], { timeout: 150000 });
  await transport.tool("list_agent_projects");

  await transport.tool("register_user_agent_project", {
    repository: "/repo/new",
  });

  assert.deepEqual(fake.toolOptions.slice(1), [undefined, undefined]);
  transport.dispose();
});

test("host preserves structured settings envelopes and unwraps other tools", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);
  const observed = callbacks();
  await transport.connect(observed.events);

  assert.deepEqual(observed.hosts, [
    {
      displayMode: "inline",
      canExpand: true,
      canSend: true,
      canShare: true,
      canDownload: false,
    },
  ]);

  assert.deepEqual(
    await transport.tool("list_agent_tasks", { conversation_id: null }),
    ["task"],
  );

  assert.deepEqual(fake.calls[0], {
    name: "list_agent_tasks",
    arguments: { conversation_id: null },
  });

  const settings = { values: { max_runtime_minutes: 0.5, max_cost_usd: null } };
  fake.respond({ structuredContent: settings });
  assert.deepEqual(await transport.tool("get_agent_settings"), settings);

  assert.deepEqual(
    await transport.tool("set_agent_settings", { max_runtime_minutes: 0.5 }),
    settings,
  );

  fake.app.ontoolresult({
    structuredContent: { panel_scope: { conversation_id: null } },
  });

  assert.deepEqual(observed.scopes, [
    { panel_scope: { conversation_id: null } },
  ]);

  transport.dispose();
});

test("host tool errors and missing structured output surface meaningful failures", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);

  fake.respond({
    isError: true,
    content: [
      { type: "text", text: "Repository missing" },
      { type: "image" },
      { type: "text", text: "Register it first" },
    ],
  });

  await assert.rejects(
    transport.tool("list_agent_projects"),
    /Repository missing[\s\S]*Register it first/,
  );

  fake.respond({ isError: true, content: [] });
  await assert.rejects(transport.tool("list_agent_projects"), /tool failed/);
  fake.respond({ content: [{ type: "text", text: "unstructured" }] });

  await assert.rejects(
    transport.tool("list_agent_tasks"),
    /no structured data/,
  );

  transport.dispose();
});

test("host sends messages, shares selection context and toggles available display modes", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);
  await transport.send("Review the result");
  await transport.share({ selected_task: "task-a" });
  await transport.expand();

  assert.deepEqual(fake.calls, [
    { role: "user", content: [{ type: "text", text: "Review the result" }] },
    { structuredContent: { selected_task: "task-a" } },
    { mode: "fullscreen" },
  ]);

  fake.app.getHostContext = () => ({
    displayMode: "fullscreen",
    availableDisplayModes: ["inline", "fullscreen"],
  });

  await transport.expand();
  assert.deepEqual(fake.calls.at(-1), { mode: "inline" });
  fake.app.sendMessage = async () => ({ isError: true });
  await assert.rejects(transport.send("message"), /host declined delivery/);
  transport.dispose();
});

test("host teardown suppresses subsequent scope delivery and tools", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);
  const observed = callbacks();
  await transport.connect(observed.events);
  assert.deepEqual(await fake.app.onteardown(), {});
  assert.equal(observed.counts().teardowns, 1);

  fake.app.ontoolresult({
    structuredContent: { panel_scope: { conversation_id: "late-chat" } },
  });

  assert.deepEqual(observed.scopes, []);
  await assert.rejects(transport.tool("list_agent_tasks"), /closed/);
  assert.deepEqual(fake.calls, []);
});

test("host teardown during connect does not query host capabilities afterward", async () => {
  const fake = hostApp();
  let resolve!: () => void;

  fake.app.connect = () =>
    new Promise<void>((yes) => {
      resolve = yes;
    });

  fake.app.getHostCapabilities = () => {
    throw new Error("Host already closed");
  };

  const transport = new HostTransport(fake.app as any);
  const observed = callbacks();
  const connecting = transport.connect(observed.events);
  await fake.app.onteardown();
  resolve();
  await connecting;
  assert.equal(observed.counts().teardowns, 1);
  assert.deepEqual(observed.hosts, []);
});

test("host routes user actions through app-only aliases and preserves settings envelopes", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);

  try {
    const taskArgs = {
      description: "Review changes",
      approval_mode: "parent_agent",
    };

    const task = { id: "created", approval_mode: "parent_agent" };

    fake.respond({
      structuredContent: {
        result: task,
        panel_scope: { conversation_id: null },
      },
    });

    assert.deepEqual(await transport.tool("start_agent_task", taskArgs), task);

    const decision = {
      task_id: "created",
      request_id: "request",
      approved: true,
      message: "Proceed",
    };

    fake.respond({
      structuredContent: { result: { id: "created", status: "running" } },
    });

    assert.deepEqual(await transport.tool("submit_agent_input", decision), {
      id: "created",
      status: "running",
    });

    const settingsArgs = { set: { default_approval_mode: "parent_agent" } };

    const settings = {
      values: { default_approval_mode: "parent_agent" },
      schema: { type: "object" },
      sections: [],
    };

    fake.respond({ structuredContent: settings });

    assert.deepEqual(
      await transport.tool("update_agent_settings", settingsArgs),
      settings,
    );

    assert.deepEqual(fake.calls, [
      { name: "start_user_agent_task", arguments: taskArgs },
      { name: "submit_user_agent_input", arguments: decision },
      { name: "update_user_agent_settings", arguments: settingsArgs },
    ]);
  } finally {
    transport.dispose();
  }
});

test("host downloads send text and binary files as embedded resources", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);

  await transport.download({
    name: "notes v1.md",
    mimeType: "text/markdown",
    text: "# Notes",
  });

  await transport.download({
    name: "logo.png",
    mimeType: "image/png",
    base64: "AAAA",
  });

  assert.deepEqual(fake.calls, [
    {
      contents: [
        {
          type: "resource",
          resource: {
            uri: "file:///notes%20v1.md",
            mimeType: "text/markdown",
            text: "# Notes",
          },
        },
      ],
    },
    {
      contents: [
        {
          type: "resource",
          resource: {
            uri: "file:///logo.png",
            mimeType: "image/png",
            blob: "AAAA",
          },
        },
      ],
    },
  ]);

  fake.declineDownloads();

  await assert.rejects(
    transport.download({ name: "a.txt", mimeType: "text/plain", text: "" }),
    /cancelled/,
  );

  transport.dispose();
});
