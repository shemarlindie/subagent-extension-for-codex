import assert from "node:assert/strict";

import { test } from "vitest";

import type { Task } from "../src/core/model";
import {
  codexMeta,
  fixtureCall,
  fixtureLaunchArgs,
  normalizeCwd,
  type Settings,
  settingsFrom,
  threadLabel,
  threadsOf,
} from "../ui/dev/host-helpers";
import { PREVIEW_THREAD } from "../ui/transports/preview-fixtures";

const defaults: Settings = {
  source: "fixtures",
  launch: "thread",
  theme: "light",
  displayMode: "inline",
  width: "480",
  canSend: true,
  canShare: true,
  showInspector: false,
  threadId: PREVIEW_THREAD,
  cwd: "file:///repo",
  autoRegister: true,
  addedProjects: [],
  styles: "",
};

test("a typed cwd becomes the file URI Codex sends", () => {
  assert.equal(normalizeCwd("  /repo/src "), "file:///repo/src");
  // Spaces, "#" and "?" are escaped so the path survives the round trip.
  const uri = normalizeCwd("/a b/#x?y");
  assert.equal(uri, "file:///a%20b/%23x%3Fy");
  assert.equal(decodeURIComponent(new URL(uri).pathname), "/a b/#x?y");
  for (const kept of ["file:///repo", "", "relative/path"])
    assert.equal(normalizeCwd(kept), kept);
});

test("saved settings override defaults and old plain cwds are converted", () => {
  assert.deepEqual(
    settingsFrom(defaults, JSON.stringify({ cwd: "/old", width: "fill" })),
    { ...defaults, cwd: "file:///old", width: "fill" },
  );

  assert.deepEqual(settingsFrom(defaults, null), defaults);
  assert.deepEqual(settingsFrom(defaults, "not json"), defaults);
});

test("saved bridge log visibility migrates to the inspector setting", () => {
  const migrated = settingsFrom(defaults, JSON.stringify({ showLog: true }));

  assert.equal(migrated.showInspector, true);
  assert.equal("showLog" in migrated, false);

  const currentSettingWins = settingsFrom(
    defaults,
    JSON.stringify({ showLog: true, showInspector: false }),
  );

  assert.equal(currentSettingWins.showInspector, false);
});

test("thread launches carry Codex metadata; global launches carry none", () => {
  assert.deepEqual(codexMeta(defaults), {
    threadId: PREVIEW_THREAD,
    "codex/sandbox-state-meta": { sandboxCwd: "file:///repo" },
  });

  assert.deepEqual(fixtureLaunchArgs(defaults), {
    conversation_id: PREVIEW_THREAD,
    host_directory: "file:///repo",
  });

  assert.deepEqual(codexMeta({ ...defaults, threadId: "", cwd: "" }), {});
  const global = { ...defaults, launch: "global" as const };
  assert.equal(codexMeta(global), undefined);
  assert.deepEqual(fixtureLaunchArgs(global), {});
});

test("fixture results are shaped like the service's tool results", () => {
  // Openers and settings return their payload; other tools wrap it in result.
  const opened = fixtureCall("open_codex_subagent_extension", {}, {});
  assert.ok("panel_scope" in opened.structuredContent!);
  const listed = fixtureCall("list_agent_projects", {}, {});
  assert.ok(Array.isArray(listed.structuredContent!.result));
  const failed = fixtureCall("start_agent_task", {}, {});
  assert.equal(failed.isError, true);
  assert.match(String(failed.content[0]!.text), /Design preview only/);
});

test("threads are grouped by conversation, newest first", () => {
  const task = (
    conversation_id: string | undefined,
    title: string,
    at: number,
  ) =>
    ({
      conversation_id,
      title,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, at)).toISOString(),
    }) as Task;

  assert.deepEqual(
    threadsOf([
      task("a", "First in a", 1),
      task("b", "Only in b", 2),
      task(undefined, "Console task", 9),
      task("a", "Latest in a", 3),
    ]),
    [
      { id: "a", latest: "Latest in a", tasks: 2 },
      { id: "b", latest: "Only in b", tasks: 1 },
    ],
  );
});

test("thread labels shorten long IDs and name empty threads", () => {
  assert.equal(
    threadLabel({ id: "dev-thread", latest: "Fix it", tasks: 1 }),
    "dev-thread · Fix it (1 task)",
  );

  assert.equal(
    threadLabel({
      id: "00000000-0000-4000-8000-000000000001",
      latest: "Fix it",
      tasks: 3,
    }),
    "00000000… · Fix it (3 tasks)",
  );

  assert.equal(
    threadLabel({ id: "", latest: "", tasks: 0 }),
    "(none) · no tasks",
  );
});
