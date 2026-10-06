import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import sharp from "sharp";
import { test } from "vitest";

import {
  summarizeStoredArtifact,
  thumbnail,
  unreadableSummary,
} from "../src/core/artifact-summary.js";
import { startSchema, type Task } from "../src/core/model.js";
import { Store } from "../src/core/store.js";
import { callTool } from "../src/server/tools.js";

function task(): Task {
  return {
    ...startSchema.parse({
      title: "Build",
      description: "Build",
      worker_profile: "reviewer",
    }),
    title: "Build",
    id: "build",
    owner: "alice",
    status: "completed",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    instructions: [],
    attempt: 1,
    runtime_ms: 0,
  };
}

async function withStore(run: (store: Store, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "artifact-summary-"));
  const path = join(dir, "tasks.sqlite");
  const store = new Store(path);

  try {
    await run(store, path);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** A solid image; alpha 0 makes it transparent. */
async function image(
  width: number,
  height: number,
  format: "png" | "webp" = "png",
  alpha = 1,
) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 58, g: 131, b: 247, alpha },
    },
  })
    [format]()
    .toBuffer();
}

async function png(width: number, height: number) {
  return (await image(width, height)).toString("base64");
}

/** The decoded size of a thumbnail data URL. */
async function size(src: string | undefined) {
  const { width, height } = await sharp(
    Buffer.from(src!.split(",")[1], "base64"),
  ).metadata();

  return [width, height];
}

test("raster images get a bounded thumbnail; transparency keeps PNG", async () => {
  // An opaque image with an alpha channel (like most screenshots) and one
  // without both become JPEG.
  const opaque = await thumbnail(await image(1200, 800), "image/png");

  const flat = await sharp(await image(1200, 800))
    .flatten()
    .png()
    .toBuffer();

  const jpeg = await thumbnail(flat, "image/png");

  assert.match(opaque!, /^data:image\/jpeg;base64,/);
  assert.match(jpeg!, /^data:image\/jpeg;base64,/);
  assert.deepEqual(await size(jpeg), [320, 213]);

  const transparent = await thumbnail(
    await image(40, 20, "png", 0),
    "image/png",
  );

  assert.match(transparent!, /^data:image\/png;base64,/);
  // Small images are not enlarged.
  assert.deepEqual(await size(transparent), [40, 20]);

  // WebP decodes, which jimp could not.
  assert.deepEqual(
    await size(await thumbnail(await image(800, 400, "webp"), "image/webp")),
    [320, 160],
  );

  assert.equal(
    await thumbnail(Buffer.from("not an image"), "image/png"),
    undefined,
  );

  assert.equal(await thumbnail(await image(4, 4), "image/bmp"), undefined);
});

test("large SVGs get a raster thumbnail; small ones stay vector", async () => {
  const shapes = Array.from(
    { length: 1500 },
    (_, index) =>
      `<circle cx="${index % 600}" cy="${index % 400}" r="3" fill="#3a83f7"/>`,
  ).join("");

  const large = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#fff"/>${shapes}</svg>`;

  assert.ok(large.length > 64_000);

  const summary = await summarizeStoredArtifact({
    id: "art_svg",
    task_id: "build",
    type: "file",
    title: "graph.svg",
    content: large,
    mime_type: "image/svg+xml",
    created_at: "",
  });

  assert.equal(summary.snippet.kind, "image");
  const src = (summary.snippet as { src: string }).src;
  // Rendered at a fractional height (400 → 213.3 px), its last row is
  // part-covered; the opaque drawing must still become a JPEG.
  assert.match(src, /^data:image\/jpeg;base64,/);
  assert.deepEqual(await size(src), [320, 213]);

  const small = await summarizeStoredArtifact({
    id: "art_small_svg",
    task_id: "build",
    type: "file",
    title: "dot.svg",
    content: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    mime_type: "image/svg+xml",
    created_at: "",
  });

  assert.match(
    (small.snippet as { src: string }).src,
    /^data:image\/svg\+xml;charset=utf-8,/,
  );
});

test("without a sharp binary, images list without thumbnails", async () => {
  assert.equal(
    await thumbnail(await image(40, 20), "image/png", async () => undefined),
    undefined,
  );
});

test("summaries list without content, are cached, and survive older rows", async () => {
  await withStore(async (store, path) => {
    const t = task();
    store.save(t);

    const report = store.artifact(
      t,
      "report",
      "Worker result",
      JSON.stringify({ summary: "x", findings: [] }),
      "application/json",
    );

    const image = store.artifact(
      t,
      "file",
      "chart.png",
      await png(800, 400),
      "image/png",
    );

    const summaries = await store.artifactSummaries(t.id, t.owner);

    assert.deepEqual(
      summaries.map((summary) => [summary.id, summary.file_name]),
      [
        [report.id, "worker-result.json"],
        [image.id, "chart.png"],
      ],
    );

    for (const summary of summaries) assert.ok(!("content" in summary));
    assert.equal(summaries[1].snippet.kind, "image");

    // Rows from before summaries existed are summarized when first listed.
    const db = new DatabaseSync(path);
    db.prepare("UPDATE artifacts SET summary=NULL").run();
    db.close();

    assert.deepEqual(await store.artifactSummaries(t.id, t.owner), summaries);

    assert.equal(
      store.artifactById(t.id, image.id, t.owner).content,
      image.content,
    );

    assert.throws(() => store.artifactById(t.id, image.id, "bob"));
    await assert.rejects(store.artifactSummaries(t.id, "bob"));
  });
});

test("an unreadable artifact gets a placeholder card without failing the list", async () => {
  await withStore(async (store, path) => {
    const t = task();
    store.save(t);
    const good = store.artifact(t, "log", "Good log", "fine\n");
    const bad = store.artifact(t, "log", "Bad log", "lost\n");
    const stale = store.artifact(t, "log", "Stale log", "kept\n");
    await store.artifactSummaries(t.id, t.owner);

    const db = new DatabaseSync(path);

    db.prepare("UPDATE artifacts SET body=?, summary=NULL WHERE id=?").run(
      "{not json",
      bad.id,
    );

    // A corrupt cached summary is rebuilt from the body, not an error.
    db.prepare("UPDATE artifacts SET summary=? WHERE id=?").run(
      "{also not json",
      stale.id,
    );

    const listed = await store.artifactSummaries(t.id, t.owner);

    assert.deepEqual(
      listed.map((summary) => [summary.id, summary.snippet.kind]),
      [
        [good.id, "lines"],
        [bad.id, "error"],
        [stale.id, "lines"],
      ],
    );

    assert.equal(listed[1].title, bad.id);
    assert.equal(listed[1].task_id, t.id);

    assert.match(
      (listed[1].snippet as { message: string }).message,
      /^This artifact could not be read: /,
    );

    // The failure is not cached: once the row is readable, it lists normally.
    db.prepare("UPDATE artifacts SET body=? WHERE id=?").run(
      JSON.stringify(bad),
      bad.id,
    );

    db.close();

    const recovered = await store.artifactSummaries(t.id, t.owner);
    assert.equal(recovered[1].file_name, "bad-log.log");
    assert.equal(recovered[1].snippet.kind, "lines");
  });
});

test("a placeholder keeps the metadata a damaged body still has", () => {
  const summary = unreadableSummary(
    "art_1",
    "task",
    JSON.stringify({
      title: "Changes",
      type: "diff",
      mime_type: "text/x-diff",
      created_at: "2026-01-01T00:00:00.000Z",
    }),
    new Error("boom"),
  );

  assert.deepEqual(summary, {
    id: "art_1",
    task_id: "task",
    type: "diff",
    title: "Changes",
    mime_type: "text/x-diff",
    created_at: "2026-01-01T00:00:00.000Z",
    file_name: "changes.diff",
    format: "diff",
    size: 0,
    snippet: {
      kind: "error",
      message: "This artifact could not be read: boom",
    },
  });
});

test("a database from before summaries gains the column without losing artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artifact-summary-legacy-"));
  const path = join(dir, "tasks.sqlite");
  const t = task();

  try {
    const legacy = new DatabaseSync(path);

    legacy.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),body TEXT NOT NULL);`);

    legacy
      .prepare("INSERT INTO tasks VALUES(?,?,?)")
      .run(t.id, t.owner, JSON.stringify(t));

    legacy.prepare("INSERT INTO artifacts VALUES(?,?,?)").run(
      "art_old",
      t.id,
      JSON.stringify({
        id: "art_old",
        task_id: t.id,
        type: "log",
        title: "Old log",
        content: "one\ntwo\n",
        mime_type: "text/plain",
        created_at: t.created_at,
      }),
    );

    legacy.close();
    const store = new Store(path);

    try {
      const [summary] = await store.artifactSummaries(t.id, t.owner);

      assert.equal(summary.file_name, "old-log.log");

      assert.deepEqual(summary.snippet, {
        kind: "lines",
        text: "one\ntwo",
      });
    } finally {
      store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("artifact summary and content tools are for the panel only", async () => {
  await withStore(async (store) => {
    const t = task();
    store.save(t);
    const log = store.artifact(t, "log", "Build log", "ok\n");
    const control = { store } as unknown as Parameters<typeof callTool>[0];

    await assert.rejects(
      callTool(control, "alice", "list_user_agent_artifacts", {
        task_id: t.id,
      }),
      /User tools require a user interface/,
    );

    const [summary] = (await callTool(
      control,
      "alice",
      "list_user_agent_artifacts",
      { task_id: t.id },
      "user",
    )) as { id: string; size: number }[];

    assert.equal(summary.id, log.id);
    assert.equal(summary.size, 3);

    assert.deepEqual(
      await callTool(
        control,
        "alice",
        "get_user_agent_artifact",
        { task_id: t.id, artifact_id: log.id },
        "user",
      ),
      log,
    );
  });
});
