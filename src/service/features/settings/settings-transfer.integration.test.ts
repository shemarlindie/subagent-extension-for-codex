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

const exported = (settings: Record<string, unknown>, format = 2) =>
  JSON.stringify({ format, version: "0.0.0", settings });

const limits = (
  cost: { enabled?: boolean; amount?: number },
  runtime: { enabled?: boolean; amount?: number },
) => ({
  set: {
    task: { budget: { max_cost_usd: cost, max_runtime_minutes: runtime } },
  },
});

test("an export restores every saved default on another owner", async (t) => {
  const settings = await fixture(t);

  settings.update("source", {
    set: {
      task: {
        worker_profile: "researcher",
        budget: {
          max_cost_usd: { enabled: true, amount: 12 },
          max_runtime_minutes: { enabled: false },
        },
      },
      providers: {
        claude: {
          permission_mode: "acceptEdits",
          settings_files: false,
          user_mcp: false,
        },
      },
    },
  });

  const { document } = exportSettings(settings, "source");
  assert.equal(JSON.parse(document).format, 2);

  const result = importSettings(settings, "target", { document });

  assert.deepEqual(result.ignored, []);
  assert.deepEqual(settings.values("target"), settings.values("source"));
});

test("an import skips unsupported values and preserves omitted settings", async (t) => {
  const settings = await fixture(t);

  settings.update("owner", {
    set: {
      task: { worktree_branch_prefix: "kept/" },
      models: { global: { model: "saved-model" } },
    },
  });

  const result = importSettings(settings, "owner", {
    document: exported({
      task: {
        worker_profile: "researcher",
        provider: "elsewhere",
        worktree_branch_prefix: "invalid prefix!",
        later: 1,
      },
      later_setting: true,
      toString: true,
      constructor: false,
    }),
  });

  assert.deepEqual(result.ignored, [
    "task.provider",
    "task.worktree_branch_prefix",
    "task.later",
    "later_setting",
    "toString",
    "constructor",
  ]);

  const values = settings.values("owner");
  assert.equal(values.task.worker_profile, "researcher");
  assert.equal(values.task.provider, "claude");
  assert.equal(values.task.worktree_branch_prefix, "kept/");
  assert.equal(values.models.global.model, "saved-model");
});

test("an import rejects text that isn't a usable export", async (t) => {
  const settings = await fixture(t);

  const attempt = (document: string) => () =>
    importSettings(settings, "owner", { document });

  assert.throws(attempt("{"), /aren't valid JSON/);
  assert.throws(attempt('{"settings": 1}'), /isn't a settings export/);
  assert.throws(attempt(exported({}, 3)), /Update the extension/);
  assert.throws(attempt(exported({ later: 1 })), /No valid settings/);
});

test("an import refuses a format 1 export from before settings were grouped", async (t) => {
  const settings = await fixture(t);

  assert.throws(
    () =>
      importSettings(settings, "owner", {
        document: exported({ default_worker_profile: "researcher" }, 1),
      }),
    /These settings come from an older version\. Export them again\./,
  );

  assert.equal(settings.values("owner").task.worker_profile, "reviewer");
});

test("a transfer preserves amounts kept while both budgets are off", async (t) => {
  const settings = await fixture(t);

  settings.update(
    "source",
    limits({ enabled: false, amount: 17 }, { enabled: false, amount: 43 }),
  );

  importSettings(settings, "target", exportSettings(settings, "source"));
  const { budget } = settings.values("target").task;
  assert.deepEqual(budget.max_cost_usd, { enabled: false, amount: 17 });
  assert.deepEqual(budget.max_runtime_minutes, { enabled: false, amount: 43 });
});

test("a fresh source restores default budget amounts over the target's saved amounts", async (t) => {
  const settings = await fixture(t);

  settings.update(
    "target",
    limits({ enabled: true, amount: 99 }, { enabled: true, amount: 99 }),
  );

  importSettings(settings, "target", exportSettings(settings, "source"));
  const { budget } = settings.values("target").task;
  assert.deepEqual(budget.max_cost_usd, { enabled: false, amount: 5 });
  assert.deepEqual(budget.max_runtime_minutes, { enabled: false, amount: 20 });
});
