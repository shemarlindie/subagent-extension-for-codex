import assert from "node:assert/strict";
import { resolve } from "node:path";

import { createServer } from "vite";
import { afterAll, test } from "vitest";

import { fixtureServicePlugin } from "../../../dev/fixture-service-plugin.js";

const projectRoot = resolve(import.meta.dirname, "..");
const serviceModule = resolve(projectRoot, "ui/dev/fixture-service.ts");

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
  await fixtureServer();

  const response = await fetch(
    `${origin}/fixture-service/tools/list_user_agent_artifacts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: "preview-blocks" }),
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);

  const body = (await response.json()) as {
    result: { id: string; file_name: string }[];
  };

  assert.ok(body.result.some((artifact) => artifact.file_name === "logo.svg"));
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
