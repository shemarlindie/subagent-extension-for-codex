import assert from "node:assert/strict";
import { resolve } from "node:path";

import { createServer } from "vite";
import { afterAll, test } from "vitest";

import { fixtureServicePlugin } from "../../../dev/fixture-service-plugin.js";
import type { Changes } from "../../../src/features/workspaces/changes.js";

const projectRoot = resolve(import.meta.dirname, "../../..");
const serviceModule = resolve(projectRoot, "ui/dev/fixture-service.ts");

let server: Awaited<ReturnType<typeof createServer>> | undefined;
let origin: string;

afterAll(async () => {
  if (server) {
    const service = (await server.ssrLoadModule(serviceModule)) as {
      closeFixtureService: () => Promise<void>;
    };

    await service.closeFixtureService();
    await server.close();
  }
});

async function fixtureServer() {
  if (server) return server;

  const created = await createServer({
    configFile: false,
    appType: "custom",
    root: resolve(projectRoot, "ui/dev"),
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

test("the Vite fixture-service route parses requests and returns tool results", async () => {
  const created = await fixtureServer();

  // No tool is served yet, so serve one for this test in the server's module graph.
  const helpers = (await created.ssrLoadModule(
    resolve(projectRoot, "ui/dev/host-helpers.ts"),
  )) as { FIXTURE_SERVICE_TOOLS: string[] };

  helpers.FIXTURE_SERVICE_TOOLS.push("list_agent_tasks");

  try {
    const response = await fetch(
      `${origin}/fixture-service/tools/list_agent_tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: null }),
      },
    );

    assert.equal(response.status, 200);

    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
    );

    const body = (await response.json()) as { result: { id: string }[] };
    assert.ok(body.result.some((task) => task.id === "preview-blocks"));
  } finally {
    helpers.FIXTURE_SERVICE_TOOLS.pop();
  }
});

test("fixture changes come from real Git repositories built per task", async () => {
  await fixtureServer();

  const changes = async (task_id: string, scope = "task") => {
    const response = await fetch(
      `${origin}/fixture-service/tools/get_user_agent_changes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id, scope }),
      },
    );

    assert.equal(response.status, 200);

    return (
      (await response.json()) as {
        result: Changes;
      }
    ).result;
  };

  const paths = (result: Changes) => result.files.map((file) => file.path);

  // The 60-file diff, with its rename and deletion, in one page.
  const build = await changes("preview-build");
  assert.equal(build.files.length, 60);
  assert.equal(build.next_cursor, undefined);
  assert.ok(build.files.some((file) => file.status === "renamed"));
  assert.ok(build.files.some((file) => file.status === "deleted"));
  assert.equal(build.diff.match(/^diff --git /gm)?.length, 60);

  // Two committed turns on a worktree branch; This turn has only the second.
  assert.deepEqual(paths(await changes("preview-interrupted")), [
    "ui/inspector.css",
    "ui/inspector.tsx",
    "ui/task-facts.tsx",
  ]);

  assert.deepEqual(paths(await changes("preview-interrupted", "turn")), [
    "ui/inspector.tsx",
    "ui/task-facts.tsx",
  ]);

  // current_repo leaves out the user's earlier README edit.
  const refactor = await changes("preview-refactor");
  assert.ok(!paths(refactor).includes("README.md"));
  assert.ok(refactor.files.some((file) => file.binary));

  assert.deepEqual(await changes("preview-failed"), {
    scope: "task",
    state: "workspace_missing",
    branch: "agent/preview-failed",
    files: [],
    additions: 0,
    deletions: 0,
    diff: "",
  });
});

test("the Vite fixture-service route serializes service errors as JSON", async () => {
  await fixtureServer();

  const response = await fetch(
    `${origin}/fixture-service/tools/list_agent_tasks`,
    { method: "POST", body: "{}" },
  );

  assert.equal(response.status, 400);

  assert.deepEqual(await response.json(), {
    error: "The fixture service does not serve list_agent_tasks",
  });
});
