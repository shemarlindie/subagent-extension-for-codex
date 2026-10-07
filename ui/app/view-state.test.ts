import assert from "node:assert/strict";

import { test, vi } from "vitest";

import type { UiStatePersistence } from "../shared/state/types";
import { browserUiState, embeddedDevHostUiState } from "./view-state";

function page(href: string) {
  let currentUrl = new URL(href);
  const values = new Map<string, string>();

  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } as Storage;

  const win = {
    get location() {
      return { href: currentUrl.href };
    },
    history: {
      state: { keep: true },
      replaceState: (_state: unknown, _title: string, url: URL) => {
        currentUrl = new URL(url.href);
      },
    },
    localStorage: storage,
    sessionStorage: storage,
  } as unknown as Window;

  Object.defineProperty(win, "parent", {
    configurable: true,
    get: () => win,
  });

  return {
    win,
    storage,
    get href() {
      return currentUrl.href;
    },
  };
}

test("browser state keeps shareable choices in the URL without dropping unrelated state", () => {
  const browser = page(
    "https://example.test/panel?keep=1&dw_project=%2Frepo%2Fone&dw_task=task-1&dw_filter=active&dw_search=Migrate+me&dw_tab=details#activity",
  );

  const uiState = browserUiState(browser.win);

  assert.deepEqual(uiState.initial, {
    view: {
      repository: "/repo/one",
      selected: "task-1",
      filter: "active",
      search: "Migrate me",
      tab: "details",
    },
  });

  uiState.save({
    view: {
      repository: "/repo/two",
      browsing: true,
      filter: "failed",
      search: "",
    },
  });

  const url = new URL(browser.href);
  assert.equal(url.searchParams.get("keep"), "1");
  assert.equal(url.searchParams.get("dw_project"), "/repo/two");
  assert.equal(url.searchParams.get("dw_browse"), "1");
  assert.equal(url.searchParams.get("dw_filter"), "failed");
  assert.equal(url.searchParams.has("dw_task"), false);
  assert.equal(url.searchParams.get("dw_search"), "Migrate me");
  assert.equal(url.searchParams.has("dw_tab"), false);
  assert.equal(url.searchParams.has("dw_dlg_project"), false);
  assert.equal(url.hash, "#activity");

  uiState.flush?.();
  assert.equal(new URL(browser.href).searchParams.has("dw_search"), false);
});

test("dialog flags use one per unique dialog while drafts stay in local storage", () => {
  const browser = page("https://example.test/panel?keep=1");

  const dialogs = [
    {
      kind: "delegate" as const,
      repository: "/repo/one",
      revision: "main",
      draft: { description: "private task request" },
    },
    {
      kind: "file" as const,
      taskId: "task-1",
      path: "src/config.ts",
    },
  ];

  browserUiState(browser.win).save({ view: { selected: "task-1" }, dialogs });

  const url = new URL(browser.href);
  assert.equal(url.searchParams.get("dw_dlg_delegate"), "1");
  assert.equal(url.searchParams.get("dw_dlg_file"), "1");
  assert.equal(url.searchParams.has("dw_dlg_project"), false);
  assert.equal(browser.href.includes("private task request"), false);

  assert.deepEqual(browserUiState(browser.win).initial, {
    view: { selected: "task-1" },
    dialogs,
  });

  url.searchParams.delete("dw_dlg_file");
  browser.win.history.replaceState(browser.win.history.state, "", url);

  assert.deepEqual(browserUiState(browser.win).initial, {
    view: { selected: "task-1" },
    dialogs: [dialogs[0]],
  });

  browserUiState(browser.win).save({ view: { selected: "task-1" } });

  assert.equal(
    new URL(browser.href).searchParams.has("dw_dlg_delegate"),
    false,
  );

  assert.equal(new URL(browser.href).searchParams.has("dw_dlg_file"), false);

  assert.deepEqual(browserUiState(browser.win).initial, {
    view: { selected: "task-1" },
  });
});

test("debounces dialog draft writes, flushes pending drafts, and closes immediately", (t) => {
  vi.useFakeTimers();

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const browser = page("https://example.test/panel");
  const uiState = browserUiState(browser.win);

  const initial = {
    kind: "delegate" as const,
    repository: "/repo/one",
    revision: "main",
    draft: { description: "first" },
  };

  const updated = { ...initial, draft: { description: "updated" } };
  const storageKey = "codex-subagent-extension.dialog.v1";

  uiState.save({ view: {}, dialogs: [initial] });
  uiState.save({ view: {}, dialogs: [updated] });

  assert.deepEqual(JSON.parse(browser.storage.getItem(storageKey)!), [initial]);
  assert.equal(new URL(browser.href).searchParams.get("dw_dlg_delegate"), "1");

  vi.advanceTimersByTime(249);
  assert.deepEqual(JSON.parse(browser.storage.getItem(storageKey)!), [initial]);

  vi.advanceTimersByTime(1);
  assert.deepEqual(JSON.parse(browser.storage.getItem(storageKey)!), [updated]);

  const flushed = { ...initial, draft: { description: "flush on leave" } };
  uiState.save({ view: {}, dialogs: [flushed] });
  uiState.flush?.();
  assert.deepEqual(JSON.parse(browser.storage.getItem(storageKey)!), [flushed]);

  uiState.save({ view: {}, dialogs: [] });
  assert.equal(browser.storage.getItem(storageKey), null);

  assert.equal(
    new URL(browser.href).searchParams.has("dw_dlg_delegate"),
    false,
  );
});

test("debounces search URL updates, resets while typing, and flushes on leave", (t) => {
  vi.useFakeTimers();

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const browser = page("https://example.test/panel");
  const uiState = browserUiState(browser.win);

  uiState.save({ view: { search: "Mig", filter: "active" } });

  const params = new URL(browser.href).searchParams;
  assert.equal(params.get("dw_filter"), "active");
  assert.equal(params.has("dw_search"), false);

  vi.advanceTimersByTime(200);
  uiState.save({ view: { search: "Migrate", filter: "active" } });

  vi.advanceTimersByTime(249);
  assert.equal(new URL(browser.href).searchParams.has("dw_search"), false);

  vi.advanceTimersByTime(1);
  assert.equal(new URL(browser.href).searchParams.get("dw_search"), "Migrate");

  uiState.save({ view: { search: "Migrate config", filter: "active" } });
  uiState.flush?.();

  assert.equal(
    new URL(browser.href).searchParams.get("dw_search"),
    "Migrate config",
  );
});

test("action variants have distinct dialog flags", () => {
  const browser = page("https://example.test/panel");

  const dialogs = [
    { kind: "control" as const, action: "steer" as const, taskId: "task-1" },
    { kind: "control" as const, action: "continue" as const, taskId: "task-2" },
    { kind: "respond" as const, taskId: "task-1", requestId: "request-1" },
    { kind: "delete" as const, taskId: "task-3" },
    { kind: "worktree" as const, action: "remove" as const, taskId: "task-1" },
    {
      kind: "worktree" as const,
      action: "delete-branch" as const,
      taskId: "task-2",
    },
  ];

  browserUiState(browser.win).save({ view: {}, dialogs });

  const params = new URL(browser.href).searchParams;
  assert.equal(params.get("dw_dlg_steer"), "1");
  assert.equal(params.get("dw_dlg_continue"), "1");
  assert.equal(params.get("dw_dlg_permission"), "1");
  assert.equal(params.get("dw_dlg_delete_task"), "1");
  assert.equal(params.get("dw_dlg_worktree_remove"), "1");
  assert.equal(params.get("dw_dlg_worktree_delete_branch"), "1");
  assert.equal(params.has("dw_dlg_control"), false);
  assert.deepEqual(browserUiState(browser.win).initial.dialogs, dialogs);
});

test("invalid URL choices are ignored and selected tasks suppress list mode", () => {
  const browser = page(
    "https://example.test/?dw_task=task-1&dw_browse=1&dw_filter=unknown&dw_tab=unknown",
  );

  assert.deepEqual(browserUiState(browser.win).initial, {
    view: { selected: "task-1" },
  });
});

test("an embedded dev panel shares its host's URL and local dialog storage", () => {
  const host = page("http://localhost:5317/?keep=host");

  const hostWindow = host.win as Window & {
    __CODEX_SUBAGENT_DEV_UI_STATE__?: UiStatePersistence;
  };

  hostWindow.__CODEX_SUBAGENT_DEV_UI_STATE__ = browserUiState(host.win);

  const frame = page("http://localhost:5317/panel.html");

  Object.defineProperty(frame.win, "parent", {
    configurable: true,
    get: () => host.win,
  });

  const embedded = embeddedDevHostUiState(frame.win);
  assert.ok(embedded);
  assert.deepEqual(embedded.initial, { view: {} });

  embedded.save({
    view: { selected: "task-2", tab: "activity" },
    dialogs: [{ kind: "project", repository: "/repo/two" }],
  });

  const url = new URL(host.href);
  assert.equal(url.searchParams.get("keep"), "host");
  assert.equal(url.searchParams.get("dw_task"), "task-2");
  assert.equal(url.searchParams.get("dw_tab"), "activity");
  assert.equal(url.searchParams.get("dw_dlg_project"), "1");
  assert.equal(embedded.initial.dialogs?.[0]?.kind, "project");
  assert.equal(embeddedDevHostUiState(host.win), undefined);
});
