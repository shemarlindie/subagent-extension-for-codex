import assert from "node:assert/strict";

import { McpUiHostStylesSchema } from "@modelcontextprotocol/ext-apps";
import { expect, test, vi } from "vitest";

import { SendRejectedError } from "../../shared/tasks/conversation/send-errors";
import type { TransportEvents } from "../app/state/types";
import { ConsoleTransport } from "./console";
import { HostTransport } from "./host";
import { filterUnsupportedHostStyleVariables } from "./host-context-compat";

function callbacks() {
  const statuses: string[] = [];
  const scopes: unknown[] = [];
  const hosts: unknown[] = [];
  const drafts: unknown[] = [];
  const revisions: string[] = [];
  let logins = 0,
    teardowns = 0;

  const events: TransportEvents = {
    scope: (scope) => {
      scopes.push(scope);
    },
    host: (host) => {
      hosts.push(host);
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
    draft: (update) => {
      drafts.push(update);
    },
    revision: (value) => {
      revisions.push(value);
    },
  };

  return {
    events,
    statuses,
    scopes,
    hosts,
    drafts,
    revisions,
    counts: () => ({ logins, teardowns }),
  };
}

class FakeStream {
  onopen?: () => void;
  onerror?: () => void;
  change?: (event: { data: string }) => void;
  delta?: (event: { data: string }) => void;
  closes = 0;
  addEventListener(name: string, listener: (event: { data: string }) => void) {
    assert.ok(name === "change" || name === "delta", name);
    if (name === "change") this.change = listener;
    else this.delta = listener;
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
    const href =
      typeof url === "string" || url instanceof URL ? String(url) : url.url;

    calls.push({ url: href, options });

    return Response.json({ result: { ok: true } });
  }) as typeof fetch;

  const transport = new ConsoleTransport("https://console.example", request);
  const { events } = callbacks();
  await transport.connect(events);

  assert.deepEqual(
    await transport.tool("list_tasks", { conversation_id: null }),
    { ok: true },
  );

  await transport.login("local-token");

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://console.example/api/tools/list_tasks",
      "https://console.example/api/login",
    ],
  );

  for (const { options } of calls) {
    assert.equal(options.credentials, "include");
    assert.equal(options.method, "POST");

    assert.deepEqual(options.headers, {
      "Content-Type": "application/json",
      "X-Subagent-Extension-For-Codex": "1",
    });
  }

  const [toolCall, loginCall] = calls;
  assert.ok(toolCall && loginCall);

  assert.deepEqual(JSON.parse(toolCall.options.body as string), {
    conversation_id: null,
  });

  assert.deepEqual(JSON.parse(loginCall.options.body as string), {
    token: "local-token",
  });

  transport.dispose();
  await assert.rejects(transport.tool("list_tasks"), /closed/);
  assert.equal(calls.length, 2);
});

test("console authentication failure requests login, rejects sends, and server failures retain their message", async () => {
  let response = new Response(null, { status: 401 });

  const transport = new ConsoleTransport("", async () => response);

  const observed = callbacks();
  await transport.connect(observed.events);

  // Nothing ran, so a send's failure is a confirmed rejection.
  const failure = await transport
    .tool("send_message")
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(SendRejectedError);
  expect(failure).toHaveProperty("message", "Connect the console to continue.");
  assert.equal(observed.counts().logins, 1);
  response = Response.json({ error: "Project unavailable" }, { status: 500 });

  await assert.rejects(transport.tool("list_projects"), /Project unavailable/);

  transport.dispose();
});

test.each([undefined, true])(
  "console only marks explicit send rejection (%s)",
  async (sendRejected) => {
    const transport = new ConsoleTransport("", async () =>
      Response.json(
        { error: "Delivery failed", send_rejected: sendRejected },
        { status: 500 },
      ),
    );

    const failure = await transport
      .tool("send_message")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", "Delivery failed");
    expect(failure instanceof SendRejectedError).toBe(sendRejected === true);
    transport.dispose();
  },
);

test("console SSE reports each stream's revisions, and disposal closes the stream", async () => {
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
  assert.equal(transport.streamsChanges, true);
  assert.deepEqual(urls, ["https://console.example/api/events"]);
  const [first] = streams;
  assert.ok(first);
  first.onopen?.();
  first.change?.({ data: "boot:1" });
  first.onerror?.();
  assert.deepEqual(observed.statuses, ["Connected", "Reconnecting…"]);

  // A new stream starts with the revision now, which the controller compares.
  transport.watch();
  assert.equal(first.closes, 1);
  const [, second] = streams;
  assert.ok(second);
  second.change?.({ data: "boot:2" });
  assert.deepEqual(observed.revisions, ["boot:1", "boot:2"]);

  transport.dispose();
  assert.equal(second.closes, 1);
  transport.watch();
  assert.equal(streams.length, 2);
});

function hostApp(submit = false) {
  const calls: unknown[] = [];
  const toolOptions: unknown[] = [];
  let response: unknown = { structuredContent: { result: ["task"] } };

  const app = {
    ontoolresult: undefined as any,
    onhostcontextchanged: undefined as any,
    onteardown: undefined as any,
    // Tests dispatch each notification through its on* slot.
    addEventListener: (
      event: "toolresult" | "hostcontextchanged",
      handler: any,
    ) => {
      app[`on${event}`] = handler;
    },
    connect: async () => {},
    getHostCapabilities: () => ({
      serverTools: {},
      ...(submit ? { experimental: { "openai/message": {} } } : {}),
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
    openLink: async (args: { url: string }) => {
      calls.push(args);

      return { isError: args.url.includes("blocked") };
    },
  };

  return {
    app,
    calls,
    toolOptions,
    respond: (value: unknown) => {
      response = value;
    },
  };
}

test("host style filtering ignores new keys in initialization and context updates", () => {
  const initialize = filterUnsupportedHostStyleVariables({
    jsonrpc: "2.0",
    id: 1,
    result: {
      hostContext: {
        styles: {
          variables: {
            "--color-text-primary": "rgb(26, 28, 31)",
            "--safe-area-inset-top": "0px",
            "--future-host-token": "future value",
          },
        },
      },
    },
  }) as unknown as {
    result: { hostContext: { styles: { variables: Record<string, string> } } };
  };

  assert.deepEqual(initialize.result.hostContext.styles.variables, {
    "--color-text-primary": "rgb(26, 28, 31)",
  });

  assert.equal(
    McpUiHostStylesSchema.safeParse({
      variables: initialize.result.hostContext.styles.variables,
    }).success,
    true,
  );

  const update = filterUnsupportedHostStyleVariables({
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: {
      styles: {
        variables: {
          "--safe-area-inset-bottom": "0px",
          "--future-host-token": "future value",
        },
      },
    },
  }) as unknown as {
    params: { styles: { variables: Record<string, string> } };
  };

  assert.deepEqual(update.params.styles.variables, {});
});

test("host folder browsing allows native interaction time while ordinary tools use default timeout", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);
  fake.respond({ structuredContent: { result: { repository: null } } });

  assert.deepEqual(await transport.tool("app_browse_project"), {
    repository: null,
  });

  assert.deepEqual(fake.calls[0], {
    name: "app_browse_project",
    arguments: {},
  });

  assert.deepEqual(fake.toolOptions[0], { timeout: 150000 });
  await transport.tool("list_projects");

  await transport.tool("app_register_project", {
    repository: "/repo/new",
  });

  assert.deepEqual(fake.toolOptions.slice(1), [undefined, undefined]);
  transport.dispose();
});

test("host opens links through the host and reports a refusal", async () => {
  const fake = hostApp();
  const transport = new HostTransport(fake.app as any);

  await transport.openLink("https://example.com/");
  assert.deepEqual(fake.calls, [{ url: "https://example.com/" }]);

  await assert.rejects(
    transport.openLink("https://blocked.example.com/"),
    /declined to open the link/,
  );

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
      canSendParent: false,
      canShare: true,
    },
  ]);

  assert.deepEqual(
    await transport.tool("list_tasks", { conversation_id: null }),
    ["task"],
  );

  assert.deepEqual(fake.calls[0], {
    name: "list_tasks",
    arguments: { conversation_id: null },
  });

  const settings = { values: { max_runtime_minutes: 0.5, max_cost_usd: null } };
  fake.respond({ structuredContent: settings });
  assert.deepEqual(await transport.tool("get_settings"), settings);

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

test("host forwards locale and time zone on connect and context changes", async () => {
  const fake = hostApp();
  let preferences = {
    locale: "en-US",
    timeZone: "America/Los_Angeles",
  };

  fake.app.getHostContext = () => ({
    displayMode: "inline",
    availableDisplayModes: ["inline", "fullscreen"],
    ...preferences,
  });

  const transport = new HostTransport(fake.app as any);
  const observed = callbacks();
  await transport.connect(observed.events);

  assert.deepEqual(observed.hosts, [
    {
      ...preferences,
      displayMode: "inline",
      canExpand: true,
      canSend: true,
      canSendParent: false,
      canShare: true,
    },
  ]);

  preferences = { locale: "ja-JP", timeZone: "Asia/Tokyo" };
  fake.app.onhostcontextchanged();

  assert.deepEqual(observed.hosts.at(-1), {
    ...preferences,
    displayMode: "inline",
    canExpand: true,
    canSend: true,
    canSendParent: false,
    canShare: true,
  });

  assert.equal(observed.hosts.length, 2);
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
    transport.tool("list_projects"),
    /Repository missing[\s\S]*Register it first/,
  );

  fake.respond({ isError: true, content: [] });
  await assert.rejects(transport.tool("list_projects"), /tool failed/);
  fake.respond({ content: [{ type: "text", text: "unstructured" }] });

  await assert.rejects(transport.tool("list_tasks"), /no structured data/);

  transport.dispose();
});

test.each([undefined, true])(
  "host only marks explicit send rejection (%s)",
  async (sendRejected) => {
    const fake = hostApp();
    const transport = new HostTransport(fake.app as any);

    fake.respond({
      isError: true,
      content: [{ type: "text", text: "Delivery failed" }],
      ...(sendRejected === undefined
        ? {}
        : { _meta: { send_rejected: sendRejected } }),
    });

    const failure = await transport
      .tool("send_message")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", "Delivery failed");
    expect(failure instanceof SendRejectedError).toBe(sendRejected === true);
    transport.dispose();
  },
);

test("host sends messages, shares selection context and requests fullscreen", async () => {
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
  await assert.rejects(transport.tool("list_tasks"), /closed/);
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

    assert.deepEqual(await transport.tool("start_task", taskArgs), task);

    const decision = {
      task_id: "created",
      request_id: "request",
      approved: true,
      message: "Proceed",
    };

    fake.respond({
      structuredContent: { result: { id: "created", status: "running" } },
    });

    assert.deepEqual(await transport.tool("submit_input", decision), {
      id: "created",
      status: "running",
    });

    const settingsArgs = {
      set: { approvals: { execution_mode: "parent_agent" } },
    };

    const settings = {
      values: { approvals: { execution_mode: "parent_agent" } },
      schema: { type: "object" },
      sections: [],
    };

    fake.respond({ structuredContent: settings });

    assert.deepEqual(
      await transport.tool("update_settings", settingsArgs),
      settings,
    );

    assert.deepEqual(fake.calls, [
      { name: "app_start_task", arguments: taskArgs },
      { name: "app_submit_input", arguments: decision },
      { name: "app_update_settings", arguments: settingsArgs },
    ]);
  } finally {
    transport.dispose();
  }
});

test("worker messages use explicit submission metadata and require host support", async () => {
  const supported = hostApp(true);
  const transport = new HostTransport(supported.app as any);
  await transport.send("Worker marker", { submit: true });

  assert.deepEqual(supported.calls, [
    {
      role: "user",
      content: [{ type: "text", text: "Worker marker" }],
      _meta: { "openai/message": { target: "active", send: true } },
    },
  ]);

  const unsupported = hostApp();

  await assert.rejects(
    new HostTransport(unsupported.app as any).send("Worker marker", {
      submit: true,
    }),
    /does not support submitting/,
  );

  assert.deepEqual(unsupported.calls, []);
});

for (const channel of ["console", "host"] as const) {
  test(`${channel} measures event decoding once and leaves other results outside that phase`, async () => {
    const timing = vi.fn();
    const observed = callbacks();
    const fake = hostApp();
    let result: unknown;

    const transport =
      channel === "console"
        ? new ConsoleTransport("", async () => Response.json({ result }))
        : new HostTransport(fake.app as any);

    await transport.connect({ ...observed.events, timing });

    const respond = (value: unknown) => {
      result = value;
      fake.respond({ structuredContent: { result: value } });
    };

    const event = {
      id: 1,
      task_id: "a",
      type: "fixture.activity",
      timestamp: "",
      data: { marker: true },
    };

    respond({ events: [event] });

    const clock = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(17);

    await transport.tool("app_get_activity");

    expect(timing).toHaveBeenCalledExactlyOnceWith(
      "activity_latest",
      "decode",
      7,
      { rows: 1, outcome: "success" },
    );

    clock.mockRestore();

    respond({ items: [], next_cursor: 0 });
    await transport.tool("app_get_chat");
    respond({ recorded: 1 });
    await transport.tool("app_record_timing");
    expect(timing).toHaveBeenCalledOnce();

    respond({ events: [{ id: "invalid" }] });

    await expect(transport.tool("app_get_turn_activity")).rejects.toThrow(
      "invalid event envelope",
    );

    expect(timing).toHaveBeenLastCalledWith(
      "activity_turn",
      "decode",
      expect.any(Number),
      { rows: 0, outcome: "error" },
    );

    transport.dispose();
  });
}
