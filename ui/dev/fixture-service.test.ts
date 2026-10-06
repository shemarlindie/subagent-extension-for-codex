import assert from "node:assert/strict";

import sharp from "sharp";
import { afterAll, test } from "vitest";

import type { ArtifactSummary } from "../../src/features/artifacts/artifact-file.js";
import type { Store } from "../../src/features/tasks/store.js";
import { closeFixtureService, fixtureServiceTool } from "./fixture-service.js";
import { FIXTURE_SERVICE_PATH, fixtureServiceCall } from "./host-helpers.js";
import { previewArtifacts } from "./preview/fixtures.js";

afterAll(closeFixtureService);

const taskIds = [...new Set(previewArtifacts.map((a) => a.task_id))];

test("large fixture artifacts stay unseeded until their task is requested", async () => {
  const summaries = (await fixtureServiceTool("list_user_agent_artifacts", {
    task_id: "preview-blocks",
  })) as ArtifactSummary[];

  assert.ok(summaries.some((summary) => summary.file_name === "logo.svg"));

  const fixture = globalThis as typeof globalThis & {
    __fixtureStore?: { store: Store };
  };

  const count = fixture.__fixtureStore?.store.db
    .prepare("SELECT COUNT(*) AS count FROM artifacts WHERE task_id=?")
    .get("preview-build-profile")?.count;

  assert.equal(Number(count ?? 0), 0);
});

test("every fixture artifact lists through the fixture service", async () => {
  for (const task_id of taskIds) {
    const summaries = (await fixtureServiceTool("list_user_agent_artifacts", {
      task_id,
    })) as ArtifactSummary[];

    assert.deepEqual(
      summaries.map((summary) => summary.id),
      previewArtifacts
        .filter((artifact) => artifact.task_id === task_id)
        .map((artifact) => artifact.id),
    );

    for (const summary of summaries)
      assert.notEqual(summary.snippet.kind, "error", summary.id);
  }
});

test("the fixture service makes real thumbnails and serves full content", async () => {
  const [flame] = (
    (await fixtureServiceTool("list_user_agent_artifacts", {
      task_id: "preview-build-profile",
    })) as ArtifactSummary[]
  ).filter((summary) => summary.id === "preview-build-flame");

  assert.equal(flame.snippet.kind, "image");
  const src = (flame.snippet as { src: string }).src;
  // The fixture PNG is opaque, so the thumbnail is a JPEG.
  assert.match(src, /^data:image\/jpeg;base64,/);

  const thumbnail = await sharp(
    Buffer.from(src.split(",")[1], "base64"),
  ).metadata();

  assert.deepEqual([thumbnail.width, thumbnail.height], [320, 213]);

  const fixture = previewArtifacts.find(
    (artifact) => artifact.id === "preview-build-log",
  )!;

  assert.deepEqual(
    await fixtureServiceTool("get_user_agent_artifact", {
      task_id: fixture.task_id,
      artifact_id: fixture.id,
    }),
    JSON.parse(JSON.stringify(fixture)),
  );

  await assert.rejects(
    fixtureServiceTool("list_agent_tasks", {}),
    /does not serve list_agent_tasks/,
  );
});

test("the dev host wraps fixture service responses like fixture calls", async () => {
  const requests: [string, RequestInit | undefined][] = [];

  const ok = await fixtureServiceCall(
    "list_user_agent_artifacts",
    { task_id: "x" },
    async (url, init) => {
      requests.push([String(url), init]);

      return Response.json({ result: [] });
    },
  );

  assert.deepEqual(ok, {
    content: [{ type: "text", text: "[]" }],
    structuredContent: { result: [] },
  });

  assert.equal(
    requests[0][0],
    `${FIXTURE_SERVICE_PATH}list_user_agent_artifacts`,
  );

  assert.equal(requests[0][1]?.body, '{"task_id":"x"}');

  const failed = await fixtureServiceCall(
    "get_user_agent_artifact",
    {},
    async () => Response.json({ error: "Artifact not found" }, { status: 400 }),
  );

  assert.deepEqual(failed, {
    isError: true,
    content: [{ type: "text", text: "Artifact not found" }],
  });
});
