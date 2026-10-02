import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { previewTasks } from "../ui/codex-fixtures.ts";

const source = await readFile(
  new URL("../ui/codex.ts", import.meta.url),
  "utf8",
);
const shell = (
  await readFile(new URL("../ui/codex.html", import.meta.url), "utf8")
)
  .split(/<body[^>]*>/)[1]
  .split("<script")[0];
const { code } = await transform(
  source
    .replace(
      /import\s*\{\s*App,[\s\S]*?\}\s*from "@modelcontextprotocol\/ext-apps";/,
      "const { MockApp: App, applyDocumentTheme, applyHostStyleVariables } = globalThis;",
    )
    .replace(
      /import\s*\{\s*previewTasks,[\s\S]*?\}\s*from "\.\/codex-fixtures";/,
      "const previewTasks = [], previewEvents = [], previewArtifacts = [];",
    ),
  { loader: "ts", format: "iife", target: "es2023" },
);
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

// A small DOM harness parses the real rendered markup and dispatches bubbling
// clicks, including the original event path when a handler replaces its target.
class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  parent: Element | null = null;
  onclick: (() => unknown) | null = null;
  onclose: (() => void) | null = null;
  value = "";
  validityMessage = "";
  textContent = "";
  hidden = false;
  disabled = false;
  open = false;
  scrollTop = 0;
  private html = "";
  constructor(
    readonly tag: string,
    readonly document: Document,
  ) {}
  get id() {
    return this.attributes.id ?? "";
  }
  get innerHTML() {
    return this.html;
  }
  set innerHTML(html: string) {
    this.html = html;
    this.children = [];
    const stack: Element[] = [this];
    for (const match of html.matchAll(/<\/?([\w-]+)\b([^>]*)>/g)) {
      const [, tag, attrs] = match;
      if (match[0].startsWith("</")) {
        if (stack.at(-1)?.tag === tag) stack.pop();
        continue;
      }
      const element = new Element(tag, this.document);
      for (const attribute of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g))
        element.setAttribute(attribute[1], attribute[2] ?? "");
      element.parent = stack.at(-1)!;
      element.parent.children.push(element);
      if (!["input", "br", "hr", "img"].includes(tag)) stack.push(element);
    }
    for (const select of this.querySelectorAll("select")) {
      const option =
        select.options.find((o) => "selected" in o.attributes) ??
        select.options[0];
      select.value = option?.value ?? "";
    }
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name === "value") this.value = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = value;
  }
  get options() {
    return this.querySelectorAll("option");
  }
  get selectedOptions() {
    return this.options.filter((o) => "selected" in o.attributes);
  }
  setCustomValidity(message: string) {
    this.validityMessage = message;
  }
  querySelectorAll(selector: string): Element[] {
    const matches = (element: Element) =>
      selector.split(",").some((part) => {
        const [, tag, attr] = part.match(/^(\w+)?(?:\[([\w-]+)\])?$/)!;
        return (
          (!tag || element.tag === tag) &&
          (!attr ||
            (attr.startsWith("data-")
              ? attr.slice(5) in element.dataset
              : attr in element.attributes))
        );
      });
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  contains(element: Element | null): boolean {
    return element === this || this.children.some((c) => c.contains(element));
  }
  showModal() {
    assert.equal(this.open, false, "dialog already open");
    this.open = true;
  }
  close() {
    this.open = false;
    this.onclose?.();
  }
  focus() {
    this.document.activeElement = this;
  }
  click() {
    const path: Element[] = [];
    for (let node: Element | null = this; node; node = node.parent)
      path.push(node);
    for (const node of path) node.onclick?.();
  }
}
class Document {
  body = new Element("body", this);
  activeElement: Element | null = null;
  hidden = false;
  constructor() {
    this.body.innerHTML = shell;
  }
  getElementById(id: string): Element {
    const find = (element: Element): Element | undefined => {
      if (element.id === id) return element;
      for (const child of element.children) {
        const match = find(child);
        if (match) return match;
      }
    };
    const element = find(this.body);
    assert.ok(element, `missing rendered element ${id}`);
    return element;
  }
  querySelectorAll(selector: string) {
    return this.body.querySelectorAll(selector);
  }
}
function panelHarness(
  options: {
    projects?: () => Promise<unknown>;
    runtime?: number;
    width?: number;
    tasks?: typeof previewTasks;
    context?: Record<string, unknown>;
    respond?: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown> | undefined;
  } = {},
) {
  const document = new Document();
  let tasks = structuredClone(options.tasks ?? [previewTasks[0]]);
  const calls: string[] = [];
  const requests: { name: string; arguments: Record<string, unknown> }[] = [];
  let poll!: () => void;
  let bridge!: MockApp;
  class MockApp {
    ontoolresult?: (result: any) => void;
    constructor() {
      bridge = this;
    }
    connect() {
      return Promise.resolve();
    }
    getHostContext() {
      return {};
    }
    getHostCapabilities() {
      return { serverTools: {} };
    }
    async callServerTool(request: {
      name: string;
      arguments: Record<string, unknown>;
    }) {
      const { name, arguments: args } = request;
      calls.push(name);
      requests.push(structuredClone(request));
      const response = options.respond?.(name, args);
      if (response) return { structuredContent: { result: await response } };
      if (name === "get_agent_panel_context")
        return {
          structuredContent: {
            result: options.context ?? {
              panel_scope: { conversation_id: null },
            },
          },
        };
      if (name === "get_agent_settings")
        return {
          structuredContent: {
            values: {
              default_provider: "claude",
              default_worker_profile: "reviewer",
              max_runtime_minutes: options.runtime ?? 20,
              max_cost_usd: 5,
            },
          },
        };
      return {
        structuredContent: {
          result:
            name === "list_agent_projects"
              ? await (options.projects?.() ?? Promise.resolve([]))
              : name === "list_agent_tasks"
                ? tasks
                : name === "list_available_workers"
                  ? [
                      {
                        provider: "claude",
                        profiles: ["reviewer"],
                        capabilities: {},
                      },
                    ]
                  : [],
        },
      };
    }
  }
  runInNewContext(code, {
    MockApp,
    document,
    window: { parent: {}, innerWidth: options.width ?? 1000 },
    location: { search: "" },
    URLSearchParams,
    applyDocumentTheme() {},
    applyHostStyleVariables() {},
    setInterval(fn: () => void) {
      poll = fn;
    },
  });
  return {
    document,
    bridge,
    calls,
    requests,
    poll: () => poll(),
    changeTask() {
      tasks = tasks.map((task) => ({
        ...task,
        task: `${task.task} (updated)`,
      }));
    },
    setTasks(next: typeof previewTasks) {
      tasks = structuredClone(next);
    },
  };
}

test("new task prefills the sole registered repository and accepts positive fractional runtime defaults", async () => {
  const h = panelHarness({
    projects: async () => [
      { repository: "/approved/repo", kind: "repository" },
    ],
    runtime: 0.05,
  });
  await flush();
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(h.document.getElementById("dialog").open, true);
  const repository = h.document.getElementById("repository");
  assert.equal(repository.value, "/approved/repo");
  assert.ok("required" in repository.attributes);
  assert.equal(repository.options[0].value, "");
  assert.ok("disabled" in repository.options[0].attributes);
  assert.ok("selected" in repository.options[0].attributes);
  assert.equal(repository.options[1].value, "/approved/repo");
  assert.equal(h.document.activeElement?.id, "task");
  const runtime = h.document.getElementById("runtime");
  assert.equal(runtime.attributes.min, "0");
  assert.equal(runtime.attributes.step, "any");
  assert.equal(runtime.value, "0.05");
  assert.equal(runtime.validityMessage, "");
  for (const value of ["0", "-1", "0.5", "0.05"]) {
    runtime.value = value;
    (runtime as any).oninput();
    assert.equal(Boolean(runtime.validityMessage), Number(value) <= 0);
  }
});

for (const tab of ["changes", "activity"]) {
  test(`${tab} tab survives a list re-render and bubbling clicks`, async () => {
    const h = panelHarness();
    await flush();
    const detail = h.document.getElementById("detail");
    assert.equal(detail.dataset.task, previewTasks[0].id);
    assert.equal(
      h.document.getElementById("panel").attributes["aria-labelledby"],
      "tab-result",
    );

    h.changeTask();
    h.document.getElementById("refresh").click();
    await flush();
    assert.match(h.document.getElementById("task-list").innerHTML, /updated/);
    h.document.getElementById(`tab-${tab}`).click();
    await flush();
    assert.equal(
      h.document.getElementById(`tab-${tab}`).attributes["aria-selected"],
      "true",
    );
    assert.equal(
      h.document.getElementById("panel").attributes["aria-labelledby"],
      `tab-${tab}`,
    );
    assert.equal(
      detail.onclick,
      null,
      "detail container must not select a task on bubbled clicks",
    );

    const detailReads = h.calls.filter(
      (name) => name === "get_agent_artifacts",
    ).length;
    h.document.getElementById("panel").click();
    await flush();
    assert.equal(
      h.calls.filter((name) => name === "get_agent_artifacts").length,
      detailReads,
    );
    h.poll();
    await flush();
    assert.equal(
      h.document.getElementById("panel").attributes["aria-labelledby"],
      `tab-${tab}`,
    );
  });
}

test("conversation change during project lookup discards the pending delegation dialog", async () => {
  let resolve!: (value: unknown) => void;
  const projects = new Promise((yes) => {
    resolve = yes;
  });
  let projectReads = 0;
  const h = panelHarness({
    projects: () =>
      ++projectReads === 2
        ? projects
        : Promise.resolve([
            { repository: "/current/repo", kind: "repository" },
          ]),
  });
  await flush();
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(
    h.calls.filter((name) => name === "list_agent_projects").length,
    2,
  );
  h.bridge.ontoolresult!({
    structuredContent: { panel_scope: { conversation_id: "another-chat" } },
  });
  await flush();
  resolve([{ repository: "/approved/repo", kind: "repository" }]);
  await flush();
  assert.equal(h.document.getElementById("dialog").open, false);
  assert.equal(h.document.getElementById("dialog").innerHTML, "");
  assert.equal(h.document.getElementById("error").textContent, "");
  assert.doesNotMatch(
    h.document.getElementById("project-scope").innerHTML,
    /approved\/repo/,
  );
});

test("launch selects the active task and shows Activity immediately in a narrow panel", async () => {
  const task = {
    ...previewTasks[2],
    conversation_id: "review-chat",
    repository: "/review/repo",
    revision: "review-base",
  };
  const h = panelHarness({
    width: 420,
    tasks: [],
    projects: async () => [{ repository: task.repository, kind: "repository" }],
  });
  await flush();
  const filters = h.document.querySelectorAll("[data-filter]");
  const completed = filters.find((b) => b.dataset.filter === "completed")!;
  const all = filters.find((b) => b.dataset.filter === "all")!;
  completed.click();
  assert.equal(completed.attributes["aria-pressed"], "true");
  h.setTasks([task]);
  h.bridge.ontoolresult!({
    structuredContent: {
      panel_scope: {
        conversation_id: task.conversation_id,
        repository: task.repository,
        revision: task.revision,
      },
      panel_selection: { task_id: task.id, tab: "activity" },
      tasks: [task],
    },
  });
  assert.equal(h.document.getElementById("detail").dataset.task, task.id);
  assert.equal(all.attributes["aria-pressed"], "true");
  assert.equal(completed.attributes["aria-pressed"], "false");
  assert.equal(
    h.document.getElementById("task-list").querySelector("[data-task]")?.dataset
      .task,
    task.id,
  );
  assert.equal(h.document.body.dataset.selected, "true");
  assert.equal(
    h.document.getElementById("panel").attributes["aria-labelledby"],
    "tab-activity",
  );
  assert.equal(
    h.document.getElementById("project-path").textContent,
    task.repository,
  );
  assert.equal(
    h.document.getElementById("scope").textContent,
    "This conversation",
  );
  await flush();
  assert.deepEqual(
    h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
    { conversation_id: "review-chat", repository: "/review/repo" },
  );
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(h.document.getElementById("repository").value, "/review/repo");
  assert.equal(h.document.getElementById("revision").value, "review-base");
});

test("new task uses an intentionally selected task rather than globally auto-selected history", async () => {
  const task = {
    ...previewTasks[0],
    repository: "/history/repo",
    revision: "history-commit",
  };
  const h = panelHarness({
    tasks: [task],
    projects: async () => [
      { repository: task.repository, kind: "repository" },
      { repository: "/other/repo", kind: "repository" },
    ],
  });
  await flush();
  assert.equal(h.document.getElementById("detail").dataset.task, task.id);
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(h.document.getElementById("repository").value, "");
  assert.equal(h.document.getElementById("revision").value, "HEAD");
  h.document.getElementById("dismiss").click();
  h.document.getElementById("task-list").querySelector("[data-task]")!.click();
  await flush();
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(h.document.getElementById("repository").value, task.repository);
  assert.equal(h.document.getElementById("revision").value, task.revision);
  const repository = h.document.getElementById("repository");
  assert.deepEqual(
    h.document.getElementById("deps").options.map((o) => o.value),
    [task.id],
  );
  repository.value = "/other/repo";
  (repository as any).onchange();
  assert.equal(h.document.getElementById("revision").value, "HEAD");
  assert.equal(h.document.getElementById("deps").options.length, 0);
  repository.value = task.repository;
  (repository as any).onchange();
  assert.equal(h.document.getElementById("revision").value, task.revision);
});

for (const scope of [
  { conversation_id: "review-chat" },
  { conversation_id: null, repository: "/review/repo" },
]) {
  test(`Back keeps a narrow ${scope.conversation_id ? "conversation" : "project"} panel on the task list across polling`, async () => {
    const task = {
      ...previewTasks[0],
      conversation_id: "review-chat",
      repository: "/review/repo",
    };
    const h = panelHarness({
      width: 420,
      tasks: [task],
      context: { panel_scope: scope },
      projects: async () => [
        { repository: task.repository, kind: "repository" },
      ],
    });
    await flush();
    assert.equal(h.document.getElementById("detail").dataset.task, task.id);
    h.document.getElementById("back").click();
    for (let i = 0; i < 2; i++) {
      h.poll();
      await flush();
      assert.equal(h.document.body.dataset.selected, "false");
      assert.equal(h.document.getElementById("detail").dataset.task, undefined);
      assert.equal(
        h.document.getElementById("task-list").querySelector("[data-task]")
          ?.dataset.task,
        task.id,
      );
    }
    h.document
      .getElementById("task-list")
      .querySelector("[data-task]")!
      .click();
    await flush();
    assert.equal(h.document.body.dataset.selected, "true");
    assert.equal(h.document.getElementById("detail").dataset.task, task.id);
  });
}

test("a lost explicit selection does not prefill New task from automatic global fallback", async () => {
  const selected = {
    ...previewTasks[0],
    id: "intentionally-selected",
    repository: "/chosen/repo",
    revision: "chosen-base",
  };
  const fallback = {
    ...previewTasks[0],
    id: "automatic-fallback",
    repository: "/history/repo",
    revision: "unrelated-base",
  };
  const h = panelHarness({
    tasks: [selected, fallback],
    projects: async () => [
      { repository: selected.repository, kind: "repository" },
      { repository: fallback.repository, kind: "repository" },
    ],
  });
  await flush();
  h.document.getElementById("task-list").querySelector("[data-task]")!.click();
  await flush();
  h.setTasks([fallback]);
  h.poll();
  await flush();
  assert.equal(h.document.getElementById("detail").dataset.task, fallback.id);
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(h.document.getElementById("repository").value, "");
  assert.equal(h.document.getElementById("revision").value, "HEAD");
});

test("unchanged polling preserves project option nodes while a new scope updates choices", async () => {
  const h = panelHarness({
    projects: async () => [
      { repository: "/approved/repo", kind: "repository" },
    ],
  });
  await flush();
  const picker = h.document.getElementById("project-scope");
  const options = picker.options;
  picker.focus();
  for (let i = 0; i < 2; i++) {
    h.poll();
    await flush();
    assert.equal(picker.options.length, options.length);
    picker.options.forEach((option, index) =>
      assert.equal(option, options[index]),
    );
    assert.equal(picker.value, "");
    assert.equal(h.document.activeElement, picker);
  }
  h.bridge.ontoolresult!({
    structuredContent: {
      panel_scope: {
        conversation_id: null,
        repository: "/approved/repo/nested",
      },
    },
  });
  await flush();
  assert.equal(picker.value, "/approved/repo/nested");
  assert.deepEqual(
    picker.options.map((option) => option.value),
    ["", "/approved/repo/nested", "/approved/repo"],
  );
});

test("polling and manual refresh discover registered projects while preserving scope and draft", async () => {
  let projects = [{ repository: "/approved/repo", kind: "repository" }];
  const h = panelHarness({ tasks: [], projects: async () => projects });
  await flush();
  const picker = h.document.getElementById("project-scope");
  picker.value = "/approved/repo";
  (picker as any).onchange();
  await flush();
  const search = h.document.getElementById("search");
  search.value = "pending review";
  h.document.getElementById("delegate").click();
  await flush();
  h.document.getElementById("task").value = "Keep this draft";

  for (const [index, repository] of [
    "/new/cli-project",
    "/another/cli-project",
  ].entries()) {
    projects = [...projects, { repository, kind: "repository" }];
    if (index === 0) h.poll();
    else h.document.getElementById("refresh").click();
    await flush();
    assert.deepEqual(
      picker.options.map((option) => option.value),
      ["", ...projects.map((project) => project.repository)],
    );
    assert.equal(picker.value, "/approved/repo");
    assert.equal(search.value, "pending review");
    assert.equal(h.document.getElementById("dialog").open, true);
    assert.equal(h.document.getElementById("task").value, "Keep this draft");
    assert.equal(
      h.document.getElementById("repository").value,
      "/approved/repo",
    );
    assert.deepEqual(
      h.requests.findLast((request) => request.name === "list_agent_tasks")
        ?.arguments,
      { conversation_id: null, repository: "/approved/repo" },
    );
  }
});

test("approved parents accept the current subrepository directly in New task", async () => {
  const h = panelHarness({
    tasks: [],
    context: {
      panel_scope: {
        conversation_id: "nested-chat",
        repository: "/approved/parent/nested",
        revision: "nested-base",
      },
    },
    projects: async () => [{ repository: "/approved/parent", kind: "parent" }],
  });
  await flush();
  h.document.getElementById("delegate").click();
  await flush();
  const repository = h.document.getElementById("repository");
  assert.equal(repository.tag, "input");
  assert.equal(repository.value, "/approved/parent/nested");
  assert.equal(repository.attributes.list, "approved-projects");
  assert.equal(h.document.getElementById("revision").value, "nested-base");
  assert.equal(h.document.activeElement?.id, "task");
});

test("unrelated tool results preserve the current scope, selection, and form", async () => {
  const h = panelHarness({
    projects: async () => [
      { repository: "/approved/repo", kind: "repository" },
    ],
  });
  await flush();
  h.document.getElementById("delegate").click();
  await flush();
  h.document.getElementById("task").value = "Review my pending changes";
  const reads = h.calls.length;
  h.bridge.ontoolresult!({
    structuredContent: {
      tasks: [],
      panel_selection: { task_id: "unrelated" },
      result: {
        repository: "/unrelated/repo",
        conversation_id: "unrelated-chat",
      },
    },
  });
  await flush();
  assert.equal(h.document.getElementById("dialog").open, true);
  assert.equal(
    h.document.getElementById("task").value,
    "Review my pending changes",
  );
  assert.equal(
    h.document.getElementById("detail").dataset.task,
    previewTasks[0].id,
  );
  assert.equal(h.document.getElementById("project-scope").value, "");
  assert.equal(h.calls.length, reads);
});

test("project switch drops a delayed list response from the previous scope", async () => {
  let resolve!: (value: unknown) => void;
  const delayed = new Promise((yes) => {
    resolve = yes;
  });
  let listReads = 0;
  const nextTask = {
    ...previewTasks[2],
    id: "current-project-task",
    repository: "/next/repo",
  };
  const h = panelHarness({
    projects: async () => [
      { repository: previewTasks[0].repository, kind: "repository" },
      { repository: nextTask.repository, kind: "repository" },
    ],
    respond: (name, args) =>
      name === "list_agent_tasks"
        ? ++listReads === 2
          ? delayed
          : Promise.resolve(
              args.repository === nextTask.repository
                ? [nextTask]
                : [previewTasks[0]],
            )
        : undefined,
  });
  await flush();
  h.document.getElementById("refresh").click();
  await flush();
  const picker = h.document.getElementById("project-scope");
  picker.value = nextTask.repository;
  (picker as any).onchange();
  await flush();
  assert.equal(h.document.getElementById("detail").dataset.task, undefined);
  resolve([{ ...previewTasks[0], task: "Old scope stale response" }]);
  await flush();
  assert.equal(h.document.getElementById("detail").dataset.task, nextTask.id);
  assert.match(
    h.document.getElementById("task-list").innerHTML,
    /Trace task refresh behavior/,
  );
  assert.doesNotMatch(
    h.document.getElementById("task-list").innerHTML,
    /Old scope stale response/,
  );
  assert.equal(
    h.document.getElementById("project-path").textContent,
    nextTask.repository,
  );
  assert.deepEqual(
    h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
    { conversation_id: null, repository: nextTask.repository },
  );
});

test("global and scoped lists always send an explicit conversation choice", async () => {
  const h = panelHarness();
  await flush();
  assert.deepEqual(
    h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
    { conversation_id: null },
  );
  h.bridge.ontoolresult!({
    structuredContent: { panel_scope: { conversation_id: "thread-a" } },
  });
  await flush();
  assert.deepEqual(
    h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
    { conversation_id: "thread-a" },
  );
  h.bridge.ontoolresult!({
    structuredContent: { panel_scope: { conversation_id: null } },
  });
  await flush();
  assert.deepEqual(
    h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
    { conversation_id: null },
  );
});

test("global bootstrap overrides ambient chat metadata and project choices keep tasks from every chat", async () => {
  const legacyTask = {
    ...previewTasks[0],
    id: "legacy-project-task",
    conversation_id: undefined,
    repository: "/first/repo",
  };
  const otherChatTask = {
    ...previewTasks[2],
    id: "other-chat-project-task",
    conversation_id: "different-chat",
    repository: "/second/repo",
  };
  const h = panelHarness({
    tasks: [legacyTask, otherChatTask],
    projects: async () => [
      { repository: legacyTask.repository, kind: "repository" },
      { repository: otherChatTask.repository, kind: "repository" },
    ],
    respond: (name, args) =>
      name === "get_agent_panel_context"
        ? Promise.resolve({
            panel_scope: {
              conversation_id:
                "conversation_id" in args
                  ? args.conversation_id
                  : "ambient-chat",
            },
          })
        : undefined,
  });
  await flush();
  assert.deepEqual(
    h.requests.find((r) => r.name === "get_agent_panel_context")?.arguments,
    { conversation_id: null },
  );
  assert.deepEqual(
    h.document
      .getElementById("task-list")
      .querySelectorAll("[data-task]")
      .map((row) => row.dataset.task),
    [legacyTask.id, otherChatTask.id],
  );
  assert.equal(h.document.getElementById("conversation-context").hidden, true);

  const picker = h.document.getElementById("project-scope");
  for (const task of [legacyTask, otherChatTask]) {
    picker.value = task.repository;
    (picker as any).onchange();
    await flush();
    assert.deepEqual(
      h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
      { conversation_id: null, repository: task.repository },
    );
    assert.deepEqual(
      h.document
        .getElementById("task-list")
        .querySelectorAll("[data-task]")
        .map((row) => row.dataset.task),
      [task.id],
    );
  }
});

test("All chats escapes an explicit launch while preserving the project and rejecting its delayed response", async () => {
  const scopedTask = {
    ...previewTasks[0],
    id: "launched-chat-task",
    conversation_id: "launched-chat",
    repository: "/launched/repo",
    revision: "launched-base",
  };
  const otherTask = {
    ...previewTasks[2],
    id: "other-chat-task",
    conversation_id: "other-chat",
    repository: scopedTask.repository,
  };
  let resolve!: (value: unknown) => void;
  const delayed = new Promise((yes) => {
    resolve = yes;
  });
  let delayScopedList = false;
  const h = panelHarness({
    projects: async () => [
      { repository: scopedTask.repository, kind: "repository" },
    ],
    respond: (name, args) =>
      name === "list_agent_tasks"
        ? args.conversation_id === scopedTask.conversation_id
          ? delayScopedList
            ? delayed
            : Promise.resolve([scopedTask])
          : Promise.resolve([scopedTask, otherTask])
        : undefined,
  });
  await flush();
  h.bridge.ontoolresult!({
    structuredContent: {
      panel_scope: {
        conversation_id: scopedTask.conversation_id,
        repository: scopedTask.repository,
        revision: scopedTask.revision,
      },
      panel_selection: { task_id: scopedTask.id, tab: "activity" },
      tasks: [scopedTask],
    },
  });
  await flush();
  const allChats = h.document.getElementById("conversation-context");
  assert.equal(allChats.tag, "button");
  assert.equal(allChats.hidden, false);
  assert.match(
    shell,
    /<button\b[^>]*id="conversation-context"[^>]*>All chats<\/button>/,
  );
  assert.deepEqual(
    h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
    {
      conversation_id: scopedTask.conversation_id,
      repository: scopedTask.repository,
    },
  );
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(h.document.getElementById("dialog").open, true);
  h.document
    .querySelectorAll("[data-filter]")
    .find((button) => button.dataset.filter === "completed")!
    .click();
  h.document.getElementById("search").value = "old chat search";
  (h.document.getElementById("search") as any).oninput();
  delayScopedList = true;
  h.document.getElementById("refresh").click();
  await flush();

  allChats.click();
  await flush();
  assert.equal(h.document.getElementById("dialog").open, false);
  assert.equal(h.document.getElementById("detail").dataset.task, undefined);
  assert.equal(h.document.getElementById("search").value, "");
  assert.equal(
    h.document
      .querySelectorAll("[data-filter]")
      .find((button) => button.dataset.filter === "all")!.attributes[
      "aria-pressed"
    ],
    "true",
  );
  assert.equal(allChats.hidden, true);
  assert.equal(
    h.document.getElementById("project-scope").value,
    scopedTask.repository,
  );
  resolve([{ ...scopedTask, task: "Stale chat response" }]);
  await flush();
  assert.deepEqual(
    h.requests.findLast((r) => r.name === "list_agent_tasks")?.arguments,
    { conversation_id: null, repository: scopedTask.repository },
  );
  assert.deepEqual(
    h.document
      .getElementById("task-list")
      .querySelectorAll("[data-task]")
      .map((row) => row.dataset.task),
    [scopedTask.id, otherTask.id],
  );
  assert.doesNotMatch(
    h.document.getElementById("task-list").innerHTML,
    /Stale chat response/,
  );
  assert.equal(
    h.document.getElementById("scope").textContent,
    "All conversations",
  );
  h.document.getElementById("delegate").click();
  await flush();
  assert.equal(
    h.document.getElementById("repository").value,
    scopedTask.repository,
  );
  assert.equal(
    h.document.getElementById("revision").value,
    scopedTask.revision,
  );
});

test("global delegation explicitly opts out of ambient conversation correlation", async () => {
  const h = panelHarness({
    tasks: [],
    projects: async () => [
      { repository: "/approved/repo", kind: "repository" },
    ],
    context: { panel_scope: { conversation_id: null } },
    respond: (name) =>
      name === "start_agent_task"
        ? Promise.resolve({
            ...previewTasks[2],
            repository: "/approved/repo",
            conversation_id: undefined,
          })
        : undefined,
  });
  await flush();
  h.document.getElementById("delegate").click();
  await flush();
  h.document.getElementById("task").value = "Review my work";
  await (
    h.document.getElementById("dialog").querySelector("form") as any
  ).onsubmit({ preventDefault() {} });
  const request = h.requests.find((r) => r.name === "start_agent_task")!;
  assert.equal(request.arguments.repository, "/approved/repo");
  assert.equal(request.arguments.conversation_id, null);
});

test("a request started in one scope never selects its returned task in another scope", async () => {
  let resolve!: (value: unknown) => void;
  const started = new Promise((yes) => {
    resolve = yes;
  });
  const h = panelHarness({
    tasks: [],
    projects: async () => [
      { repository: "/approved/repo", kind: "repository" },
    ],
    context: { panel_scope: { conversation_id: "original-chat" } },
    respond: (name) => (name === "start_agent_task" ? started : undefined),
  });
  await flush();
  h.document.getElementById("delegate").click();
  await flush();
  h.document.getElementById("task").value = "Review my work";
  const submission = (
    h.document.getElementById("dialog").querySelector("form") as any
  ).onsubmit({ preventDefault() {} });
  await flush();
  const request = h.requests.find((r) => r.name === "start_agent_task")!;
  assert.equal(request.arguments.repository, "/approved/repo");
  assert.equal(request.arguments.conversation_id, "original-chat");
  h.bridge.ontoolresult!({
    structuredContent: {
      panel_scope: { conversation_id: "new-chat", repository: "/new/repo" },
    },
  });
  await flush();
  assert.equal(h.document.getElementById("submit").disabled, true);
  resolve({
    ...previewTasks[2],
    id: "original-request-task",
    repository: "/approved/repo",
    conversation_id: "original-chat",
  });
  await submission;
  await flush();
  assert.equal(h.document.getElementById("detail").dataset.task, undefined);
  assert.equal(
    h.document.getElementById("project-path").textContent,
    "/new/repo",
  );
  assert.match(
    h.document.getElementById("form-error").textContent,
    /original scope/,
  );
  assert.equal(h.document.getElementById("submit").disabled, true);
  h.document.getElementById("dismiss").click();
  assert.equal(h.document.getElementById("dialog").open, false);
});
