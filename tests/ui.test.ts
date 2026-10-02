import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("../ui/app.ts", import.meta.url), "utf8");
const { code } = await transform(
  source.replace(
    'import { App } from "@modelcontextprotocol/ext-apps";',
    "const App = globalThis.MockApp;",
  ),
  { loader: "ts", format: "iife", target: "es2023" },
);
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type ToolCall = { name: string; arguments: Record<string, unknown> };
function consoleHarness(
  options: {
    embedded?: boolean;
    connect?: Promise<void>;
    tool?: (call: ToolCall) => unknown | Promise<unknown>;
  } = {},
) {
  const embedded = options.embedded ?? true;
  const calls: ToolCall[] = [];
  const requests: string[] = [];
  const requestOptions: any[] = [];
  const streamOptions: unknown[] = [];
  const streams: { url: string; closed: boolean; close(): void }[] = [];
  const elements = new Map<string, any>();
  const createElement = (attributes: Record<string, string> = {}) => {
    let html = "";
    const element: any = {
      attributes,
      value: attributes.value ?? "",
      textContent: "",
      hidden: false,
      options: [],
      validityMessage: "",
      setCustomValidity(message: string) {
        this.validityMessage = message;
      },
      focus() {},
      querySelector(selector: string) {
        return selector === "form" ? element.form : null;
      },
    };
    Object.defineProperty(element, "innerHTML", {
      get: () => html,
      set(markup: string) {
        html = markup;
        if (!markup.includes('<form class="dialog">')) return;
        element.form = { onsubmit: null };
        for (const match of markup.matchAll(/<(\w+)\b([^>]*)>/g)) {
          const attrs: Record<string, string> = {};
          for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))
            attrs[attr[1]] = attr[2] ?? "";
          if (attrs.id) elements.set(attrs.id, createElement(attrs));
        }
      },
    });
    return element;
  };
  const document = {
    hidden: false,
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  let clock = 0,
    nextTimer = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const setTimeout = (fn: () => void, delay: number) => {
    const id = ++nextTimer;
    timers.set(id, { at: clock + delay, fn });
    return id;
  };
  class MockApp {
    ontoolresult?: (result: unknown) => void;
    onteardown?: () => Promise<unknown>;
    connect() {
      return options.connect ?? Promise.resolve();
    }
    getHostCapabilities() {
      return { serverTools: {} };
    }
    async callServerTool(call: ToolCall) {
      calls.push(call);
      const result = await (options.tool?.(call) ?? []);
      return {
        structuredContent: call.name.endsWith("_agent_settings")
          ? result
          : { result },
      };
    }
  }
  let bridge!: MockApp;
  class App extends MockApp {
    constructor() {
      super();
      bridge = this;
    }
  }
  const window: any = {
    CODEX_SUBAGENT_EXTENSION_ORIGIN: "http://console.test",
  };
  window.parent = embedded ? {} : window;
  runInNewContext(code, {
    MockApp: App,
    window,
    document,
    location: { pathname: "/" },
    history: { replaceState: () => {} },
    setTimeout,
    clearTimeout: (id: number) => timers.delete(id),
    fetch: async (url: string, request: any) => {
      assert.equal(embedded, false, "embedded console attempted browser HTTP");
      requests.push(url);
      requestOptions.push(request);
      const result = await (options.tool?.({
        name: url.split("/").at(-1)!,
        arguments: JSON.parse(request.body),
      }) ?? []);
      return { status: 200, ok: true, json: async () => ({ result }) };
    },
    EventSource: class {
      closed = false;
      constructor(
        public url: string,
        options: unknown,
      ) {
        assert.equal(embedded, false, "embedded console attempted browser SSE");
        streams.push(this);
        streamOptions.push(options);
      }
      close() {
        this.closed = true;
      }
      addEventListener() {}
    },
  });
  return {
    bridge,
    calls,
    requests,
    requestOptions,
    streams,
    streamOptions,
    document,
    elements,
    pollTimers: () =>
      [...timers.values()].filter((t) => t.at - clock === 3000).length,
    async advance(ms: number) {
      const until = clock + ms;
      while (true) {
        const entry = [...timers]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        clock = entry[1].at;
        timers.delete(entry[0]);
        entry[1].fn();
        await flush();
      }
      clock = until;
      await flush();
    },
  };
}

test("delegation requires choosing a project and accepts positive fractional runtime defaults", async () => {
  const h = consoleHarness({
    tool: ({ name }) =>
      name === "get_agent_settings"
        ? { values: { max_runtime_minutes: 0.05, use_cost_budget: false } }
        : name === "list_agent_projects"
          ? [{ repository: "/approved/repo", kind: "repository" }]
          : [],
  });
  await flush();
  h.elements.get("delegate").onclick();
  await flush();
  const repository = h.elements.get("repository");
  assert.ok(repository, "delegation form must render");
  assert.equal(repository.value, "");
  assert.ok("required" in repository.attributes);
  assert.match(
    h.elements.get("modal").innerHTML,
    /<option value="" disabled selected>Choose a project<\/option>/,
  );
  const runtime = h.elements.get("runtime");
  assert.equal(runtime.attributes.min, "0");
  assert.equal(runtime.attributes.step, "any");
  assert.equal(runtime.value, "0.05");
  assert.equal(runtime.validityMessage, "");
  for (const value of ["0", "-1", "0.5", "0.05"]) {
    runtime.value = value;
    runtime.oninput();
    assert.equal(Boolean(runtime.validityMessage), Number(value) <= 0);
  }
  await h.bridge.onteardown!();
});

test("embedded sidebar starts through the host without an opening result", async () => {
  const h = consoleHarness();
  await flush();
  assert.deepEqual(
    h.calls.map((c) => c.name),
    ["list_available_workers", "list_agent_tasks"],
  );
  assert.equal(h.elements.get("login").hidden, true);
  assert.equal(h.elements.get("connection").textContent, "● Connected");
  assert.equal(h.pollTimers(), 1);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.streams, []);
  await h.bridge.onteardown!();
});

test("embedded polling skips hidden documents and waits for each refresh", async () => {
  const pending = deferred<unknown[]>();
  let reads = 0;
  const h = consoleHarness({
    tool: (call) => {
      if (call.name === "list_agent_tasks" && ++reads === 2)
        return pending.promise;
      return [];
    },
  });
  await flush();
  h.document.hidden = true;
  await h.advance(9000);
  assert.equal(reads, 1);
  h.document.hidden = false;
  await h.advance(3000);
  assert.equal(reads, 2);
  await h.advance(12000);
  assert.equal(reads, 2, "in-flight refresh must not overlap another poll");
  pending.resolve([]);
  await flush();
  assert.equal(h.pollTimers(), 1);
  await h.advance(3000);
  assert.equal(reads, 3);
  await h.bridge.onteardown!();
});

test("embedded polling retries after a host tool failure", async () => {
  let reads = 0;
  const h = consoleHarness({
    tool: (call) => {
      if (call.name === "list_agent_tasks" && ++reads === 2)
        throw new Error("host unavailable");
      return [];
    },
  });
  await flush();
  await h.advance(3000);
  assert.equal(h.elements.get("connection").textContent, "Reconnecting…");
  assert.match(h.elements.get("error").textContent, /host unavailable/);
  await h.advance(3000);
  assert.equal(reads, 3);
  assert.equal(h.elements.get("connection").textContent, "● Connected");
  await h.bridge.onteardown!();
});

for (const phase of [
  "connect",
  "workers",
  "initial refresh",
  "poll refresh",
] as const) {
  test(`teardown during ${phase} prevents further tools and polling`, async () => {
    const pending = deferred<any>();
    let reads = 0;
    const h = consoleHarness({
      connect: phase === "connect" ? pending.promise : undefined,
      tool: (call) => {
        if (phase === "workers" && call.name === "list_available_workers")
          return pending.promise;
        if (call.name === "list_agent_tasks") {
          reads++;
          if (
            (phase === "initial refresh" && reads === 1) ||
            (phase === "poll refresh" && reads === 2)
          )
            return pending.promise;
        }
        return [];
      },
    });
    await flush();
    if (phase === "poll refresh") await h.advance(3000);
    const before = h.calls.length;
    await h.bridge.onteardown!();
    // A task would normally trigger event/artifact reads after the task list resolves.
    pending.resolve(
      phase.includes("refresh")
        ? [
            {
              id: "task-after-teardown",
              task: "Pending task",
              provider: "fixture",
              worker_profile: "reviewer",
              status: "queued",
              budget: {},
              repository: "/repo",
              revision: "main",
              depends_on: [],
              created_at: "2026-10-02T00:00:00Z",
              attempt: 0,
            },
          ]
        : [],
    );
    await flush();
    await h.advance(15000);
    h.bridge.ontoolresult!({ structuredContent: { tasks: [] } });
    await flush();
    await h.advance(3000);
    assert.equal(h.calls.length, before);
    assert.equal(h.pollTimers(), 0);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.streams, []);
  });
}

test("standalone console retains authenticated browser HTTP and SSE", async () => {
  const h = consoleHarness({ embedded: false });
  await flush();
  assert.deepEqual(h.requests, [
    "http://console.test/api/tools/list_available_workers",
    "http://console.test/api/tools/list_agent_tasks",
  ]);
  for (const options of h.requestOptions) {
    assert.equal(options.credentials, "include");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-Codex-Subagent-Extension"], "1");
  }
  assert.equal(h.streams.length, 1);
  assert.equal((h.streamOptions[0] as any).withCredentials, true);
  assert.equal(h.streams[0].url, "http://console.test/api/events");
  assert.equal(h.pollTimers(), 0);
  assert.deepEqual(h.calls, []);
});

for (const embedded of [false, true]) {
  for (const failure of ["empty", "rejected"] as const) {
    for (const entrypoint of ["delegate", "empty-delegate"]) {
      test(`${embedded ? "embedded" : "standalone"} ${entrypoint} displays ${failure} project lookup error`, async () => {
        const h = consoleHarness({
          embedded,
          tool: ({ name }) => {
            if (name === "get_agent_settings") return { values: {} };
            if (name === "list_agent_projects" && failure === "rejected")
              throw new Error("project registry unavailable");
            return [];
          },
        });
        await flush();
        h.elements.get(entrypoint).onclick();
        await flush();
        assert.match(
          h.elements.get("error").textContent,
          failure === "empty"
            ? /Register a repository/
            : /project registry unavailable/,
        );
        if (embedded) await h.bridge.onteardown!();
      });
    }
  }
}
