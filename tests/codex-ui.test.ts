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
  value = "";
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
      for (const attribute of attrs.matchAll(/([\w-]+)="([^"]*)"/g))
        element.setAttribute(attribute[1], attribute[2]);
      element.parent = stack.at(-1)!;
      element.parent.children.push(element);
      if (!["input", "br", "hr", "img"].includes(tag)) stack.push(element);
    }
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = value;
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
    this.body.innerHTML =
      '<aside><input id="search"><div id="scope"></div><div id="count"></div><div id="task-list"></div></aside><main id="detail"></main>' +
      ["dialog", "delegate", "refresh", "expand", "connection", "error"]
        .map((id) => `<button id="${id}"></button>`)
        .join("");
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
function panelHarness() {
  const document = new Document();
  let task = structuredClone(previewTasks[0]);
  const calls: string[] = [];
  let poll!: () => void;
  class MockApp {
    connect() {
      return Promise.resolve();
    }
    getHostContext() {
      return {};
    }
    getHostCapabilities() {
      return { serverTools: {} };
    }
    async callServerTool({ name }: { name: string }) {
      calls.push(name);
      return {
        structuredContent: {
          result:
            name === "list_agent_tasks"
              ? [task]
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
    window: { parent: {}, innerWidth: 1000 },
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
    calls,
    poll: () => poll(),
    changeTask() {
      task = { ...task, task: `${task.task} (updated)` };
    },
  };
}

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
