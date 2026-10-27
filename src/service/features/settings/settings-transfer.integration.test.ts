import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, type TestContext } from "vitest";

import { Store } from "../tasks/storage/store.js";
import { Settings } from "./settings.js";
import { exportSettings, importSettings } from "./settings-transfer.js";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "settings-transfer-"));
  const store = new Store(join(dir, "settings.sqlite"));

  t.onTestFinished(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  return new Settings(store.database, () => ["claude"]);
}

const exported = (settings: Record<string, unknown>, format = 1) =>
  JSON.stringify({ format, version: "0.0.0", settings });

test("an export restores every saved default on another owner", async (t) => {
  const settings = await fixture(t);

  settings.update("source", {
    set: {
      default_worker_profile: "researcher",
      claude_permission_mode: "acceptEdits",
      claude_settings_files: false,
      claude_user_mcp: false,
      max_cost_usd: 12,
      use_runtime_budget: false,
    },
  });

  const { document } = exportSettings(settings, "source");
  assert.equal(JSON.parse(document).format, 1);

  const result = importSettings(settings, "target", { document });

  assert.deepEqual(result.ignored, []);
  assert.deepEqual(settings.values("target"), settings.values("source"));
});

test("an import turns limits on or off as the export had them", async (t) => {
  const settings = await fixture(t);
  settings.update("owner", { set: { use_cost_budget: false } });

  importSettings(settings, "owner", {
    document: exported({ max_cost_usd: 7, max_runtime_minutes: null }),
  });

  const values = settings.values("owner");
  assert.equal(values.max_cost_usd, 7);
  assert.equal(values.max_runtime_minutes, null);
});

test("an import skips unsupported values and preserves omitted settings", async (t) => {
  const settings = await fixture(t);

  settings.update("owner", {
    set: { worktree_branch_prefix: "kept/", default_model: "saved-model" },
  });

  const result = importSettings(settings, "owner", {
    document: exported({
      default_worker_profile: "researcher",
      default_provider: "elsewhere",
      worktree_branch_prefix: "invalid prefix!",
      later_setting: true,
      toString: true,
      constructor: false,
    }),
  });

  assert.deepEqual(result.ignored, [
    "default_provider",
    "worktree_branch_prefix",
    "later_setting",
    "toString",
    "constructor",
  ]);

  assert.equal(settings.values("owner").default_worker_profile, "researcher");
  assert.equal(settings.values("owner").default_provider, "claude");
  assert.equal(settings.values("owner").worktree_branch_prefix, "kept/");
  assert.equal(settings.values("owner").default_model, "saved-model");
});

test("an import rejects text that isn't a usable export", async (t) => {
  const settings = await fixture(t);

  const attempt = (document: string) => () =>
    importSettings(settings, "owner", { document });

  assert.throws(attempt("{"), /aren't valid JSON/);
  assert.throws(attempt('{"settings": 1}'), /isn't a settings export/);
  assert.throws(attempt(exported({}, 2)), /Update the extension/);
  assert.throws(attempt(exported({ later: 1 })), /No valid settings/);
});

test("a transfer preserves amounts remembered while both budgets are off", async (t) => {
  const settings = await fixture(t);

  settings.update("source", {
    set: {
      max_cost_usd: 17,
      max_runtime_minutes: 43,
      use_cost_budget: false,
      use_runtime_budget: false,
    },
  });

  importSettings(settings, "target", exportSettings(settings, "source"));
  assert.equal(settings.values("target").max_cost_usd, null);
  assert.equal(settings.values("target").max_runtime_minutes, null);

  settings.update("target", {
    set: { use_cost_budget: true, use_runtime_budget: true },
  });

  assert.equal(settings.values("target").max_cost_usd, 17);
  assert.equal(settings.values("target").max_runtime_minutes, 43);
});

test("a fresh source restores default budget amounts over the target's saved amounts", async (t) => {
  const settings = await fixture(t);

  settings.update("target", {
    set: { max_cost_usd: 99, max_runtime_minutes: 99 },
  });

  importSettings(settings, "target", exportSettings(settings, "source"));
  assert.equal(settings.values("target").max_cost_usd, null);
  assert.equal(settings.values("target").max_runtime_minutes, null);

  settings.update("target", {
    set: { use_cost_budget: true, use_runtime_budget: true },
  });

  assert.equal(settings.values("target").max_cost_usd, 5);
  assert.equal(settings.values("target").max_runtime_minutes, 20);
});
