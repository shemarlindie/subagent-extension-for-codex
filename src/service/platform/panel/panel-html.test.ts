import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { preloadPanelHtml, readPanelHtml } from "./panel-html.js";

async function directory(t: import("vitest").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "panel-html-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

test("serves a rebuilt page, and the last copy once the page is removed", async (t) => {
  const path = join(await directory(t), "app.html");
  await writeFile(path, "<html>first</html>");
  preloadPanelHtml(path);
  await writeFile(path, "<html>rebuilt</html>");
  assert.equal(await readPanelHtml(path), "<html>rebuilt</html>");
  await rm(path);
  assert.equal(await readPanelHtml(path), "<html>rebuilt</html>");
});

test("a page that never existed is an error", async (t) => {
  const path = join(await directory(t), "app.html");
  preloadPanelHtml(path);
  await assert.rejects(readPanelHtml(path), { code: "ENOENT" });
});
