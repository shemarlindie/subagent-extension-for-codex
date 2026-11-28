import assert from "node:assert/strict";
import { resolve } from "node:path";

import { createServer } from "vite";
import { afterAll, test } from "vitest";

import { fixtureServicePlugin } from "../../../dev/panel/fixture-service/plugin.js";
import { largeFiles } from "../../../dev/panel/scenarios/large-files.js";
import type {
  ChangedFileContent,
  ChangeList,
  FileChange,
} from "../../../src/core/shared/changes/changes.js";

const projectRoot = resolve(import.meta.dirname, "../../..");

const serviceModule = resolve(
  projectRoot,
  "dev/panel/fixture-service/service.ts",
);

let server: Awaited<ReturnType<typeof createServer>> | undefined;
let origin: string;

afterAll(async () => {
  if (server) {
    const service = (await server.ssrLoadModule(serviceModule)) as {
      closeFixtureService: () => void;
    };

    service.closeFixtureService();
    await server.close();
  }
});

async function fixtureServer() {
  if (server) return server;

  const created = await createServer({
    configFile: false,
    appType: "custom",
    root: resolve(projectRoot, "dev/panel/host"),
    plugins: [fixtureServicePlugin()],
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });

  try {
    await created.listen();
    const address = created.httpServer?.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    server = created;

    return created;
  } catch (error) {
    await created.close();
    throw error;
  }
}

/** Posts a tool call to the fixture service as JSON. */
async function call(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${origin}/fixture-service/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

  return {
    response,
    body: (await response.json()) as { result?: any; error?: string },
  };
}

/** Posts a tool call that must succeed and returns its result. */
async function result<T>(name: string, args: Record<string, unknown>) {
  const { response, body } = await call(name, args);
  assert.equal(response.status, 200, body.error);

  return body.result as T;
}

/** A listed file's diff, which must be current and recorded. */
async function fileDiff(task_id: string, path: string, list: ChangeList) {
  const change = await result<FileChange>("app_get_file_change", {
    task_id,
    scope: list.scope,
    path,
    revision: list.revision,
  });

  assert.ok(!change.stale && change.diff !== undefined);

  return change.diff;
}

test("fixture changes come from recorded edits built per task", async () => {
  await fixtureServer();

  const changes = (task_id: string, scope = "task") =>
    result<ChangeList>("app_get_change_list", { task_id, scope });

  const paths = (result: ChangeList) => result.files.map((file) => file.path);

  // A rename is recorded as a deletion and an addition.
  const build = await changes("preview-build");
  assert.equal(build.files.length, 61);
  assert.ok(build.files.some((file) => file.status === "added"));
  assert.ok(build.files.some((file) => file.status === "deleted"));

  // Commits preserve whole-task and latest-turn records.
  // Simultaneous first reads share the initialized repository and edit records.
  const [interrupted, simultaneous] = await Promise.all([
    changes("preview-interrupted"),
    changes("preview-interrupted"),
  ]);

  assert.deepEqual(simultaneous, interrupted);

  assert.deepEqual(paths(interrupted), [
    "src/panel/inspector.css",
    "src/panel/inspector.tsx",
    "src/panel/task-facts.tsx",
  ]);

  assert.deepEqual(paths(await changes("preview-interrupted", "turn")), [
    "src/panel/inspector.tsx",
    "src/panel/task-facts.tsx",
  ]);

  // Earlier user edits stay out. Binary edits are incomplete records.
  const refactor = await changes("preview-refactor");
  assert.ok(paths(refactor).length);
  assert.ok(!paths(refactor).includes("README.md"));

  assert.ok(
    refactor.files.some(
      (file) => file.path === "assets/logo.png" && file.incomplete,
    ),
  );

  assert.ok(refactor.files.some((file) => file.source === "command"));
  assert.equal(refactor.unrecorded_commands, true);

  // A later commit does not replace the task's recorded limits.
  const conversation = await changes("preview-conversation");

  assert.deepEqual(paths(conversation), [
    "src/limits.ts",
    "src/upload.ts",
    "test/upload.test.ts",
  ]);

  const limits = await fileDiff(
    "preview-conversation",
    "src/limits.ts",
    conversation,
  );

  assert.match(limits, /maxUploadBytes: 10/);
  assert.doesNotMatch(limits, /maxUploadBytes: 25/);

  assert.equal(
    conversation.additions,
    conversation.files
      .filter((file) => !file.incomplete)
      .reduce((sum, file) => sum + file.additions, 0),
  );

  // Removing a workspace leaves its recorded edits readable.
  const removed = await changes("preview-failed");
  assert.deepEqual(paths(removed), ["test/retry.test.ts"]);

  assert.match(
    await fileDiff("preview-failed", "test/retry.test.ts", removed),
    /\+test\('retries'/,
  );
});

test("the large-file fixture's diffs and files read whole", async () => {
  await fixtureServer();

  // The 20,000-row table, over a megabyte, has one diff and arrives whole
  // across its parts.
  const path = "reports/module-sizes.csv";

  const list = await result<ChangeList>("app_get_change_list", {
    task_id: "preview-profile",
    scope: "task",
  });

  const diff = await fileDiff("preview-profile", path, list);
  assert.equal(diff.match(/^diff --git /gm)?.length, 1);
  assert.ok(diff.length > 1_000_000);

  let part: ChangedFileContent | undefined;
  let content = "";

  do {
    part = await result<ChangedFileContent>("get_changed_file", {
      task_id: "preview-profile",
      path,
      cursor: part?.next_cursor,
    });

    assert.equal(part.state, "present");
    content += part.content;
  } while (part.next_cursor);

  assert.equal(
    content,
    largeFiles().find((file) => file.path === "reports/module-sizes.csv")
      ?.content,
  );
});

test("the Vite fixture-service route serializes service errors as JSON", async () => {
  await fixtureServer();

  const response = await fetch(`${origin}/fixture-service/tools/list_tasks`, {
    method: "POST",
    body: "{}",
  });

  assert.equal(response.status, 400);

  assert.deepEqual(await response.json(), {
    error: "The fixture service does not serve list_tasks",
  });
});

// Last: it changes the fixture repositories the tests above read.
test("fixture worktrees can be removed and their branches deleted with real Git", async () => {
  await fixtureServer();

  // Uncommitted work keeps the worktree until the removal is forced.
  const build = await call("app_remove_worktree", {
    task_id: "preview-build",
  });

  assert.equal(build.body.result.status, "uncommitted");
  // Uncommitted, the rename is a deleted file and an untracked one.
  assert.equal(build.body.result.files.length, 61);

  assert.deepEqual(
    (
      await call("app_remove_worktree", {
        task_id: "preview-interrupted",
      })
    ).body.result,
    { status: "removed" },
  );

  const list = { task_id: "preview-interrupted", scope: "task" };

  const afterRemoval = (await call("app_get_change_list", list)).body
    .result as ChangeList;

  assert.equal(afterRemoval.files.length, 3);

  const missingPreview = await call("get_changed_file", {
    task_id: "preview-interrupted",
    path: "src/panel/inspector.css",
  });

  assert.equal(missingPreview.body.result.state, "unavailable");

  assert.deepEqual(
    (await call("app_delete_branch", { task_id: "preview-interrupted" })).body
      .result,
    { status: "deleted" },
  );

  assert.deepEqual(
    (await call("app_get_change_list", list)).body.result,
    afterRemoval,
  );

  // A running task's worktree is in use.
  assert.match(
    (await call("app_remove_worktree", { task_id: "preview-refactor" })).body
      .error ?? "",
    /Wait until the task stops/,
  );
});
