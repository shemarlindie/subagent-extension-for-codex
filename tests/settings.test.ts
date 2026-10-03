import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  Settings,
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
} from "../src/settings.js";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "settings-test-"));
  const path = join(dir, "settings.sqlite");
  let store = new Store(path);
  let providers = ["fixture"];
  let settings = new Settings(store, () => providers);
  t.after(async () => {
    if (store.db.isOpen) store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    get settings() {
      return settings;
    },
    setProviders(available: string[]) {
      providers = available;
    },
    stored() {
      return store.db
        .prepare("SELECT body FROM user_settings ORDER BY owner")
        .all();
    },
    reopen() {
      store.close();
      store = new Store(path);
      settings = new Settings(store, () => providers);
    },
  };
}

test("native settings use scalar field schemas and expose only enabled providers", async (t) => {
  const { settings } = await fixture(t);
  const result = settings.read("alice");
  assert.deepEqual(settingsReadOutputSchema.parse(result), result);
  assert.equal(result.schema.type, "object");
  const properties = result.schema.properties!;
  assert.ok(Object.keys(properties).includes("use_cost_budget"));
  assert.deepEqual(properties.default_provider.enum, ["fixture"]);
  for (const [name, field] of Object.entries(properties)) {
    assert.ok(
      ["string", "number", "integer", "boolean"].includes(String(field.type)),
      name,
    );
    for (const keyword of ["anyOf", "oneOf", "allOf", "$ref", "default"]) {
      assert.equal(keyword in field, false, `${name} must not use ${keyword}`);
    }
  }
  assert.equal(result.values.use_cost_budget, true);
  assert.equal(result.values.max_cost_usd, 5);
});

test("native budget toggles preserve the numeric amount across edits and restart", async (t) => {
  const f = await fixture(t);
  f.settings.update("alice", {
    set: { max_cost_usd: 7, max_runtime_minutes: 9 },
  });
  const disabled = f.settings.update("alice", {
    set: { use_cost_budget: false },
  });
  assert.deepEqual(settingsUpdateOutputSchema.parse(disabled), disabled);
  assert.equal(disabled.values.use_cost_budget, false);
  assert.equal(disabled.values.max_cost_usd, 7);
  assert.equal(f.settings.values("alice").max_cost_usd, null);
  assert.equal(
    f.settings.taskInput("alice", { title: "Review", description: "Review" })
      .budget.max_cost_usd,
    null,
  );
  // A host resubmits the amount when another setting changes; the disabled toggle must win.
  f.settings.update("alice", {
    set: {
      max_cost_usd: 11,
      use_cost_budget: false,
      default_worker_profile: "implementer",
    },
  });
  f.reopen();
  assert.equal(f.settings.read("alice").values.max_cost_usd, 11);
  assert.equal(f.settings.read("alice").values.use_cost_budget, false);
  f.settings.update("alice", { set: { max_cost_usd: 12 } });
  assert.equal(f.settings.read("alice").values.use_cost_budget, false);
  assert.equal(f.settings.read("alice").values.max_cost_usd, 12);
  assert.equal(f.settings.values("alice").max_cost_usd, null);
  const enabled = f.settings.update("alice", {
    set: { use_cost_budget: true },
  });
  assert.equal(enabled.values.max_cost_usd, 12);
  assert.equal(f.settings.values("alice").max_cost_usd, 12);
  assert.equal(f.settings.values("alice").max_runtime_minutes, 9);
  assert.equal(
    f.settings.values("alice").default_worker_profile,
    "implementer",
  );
  assert.equal(f.settings.read("bob").values.max_cost_usd, 5);
});

test("removed providers fall back on effective reads without rewriting saved defaults", async (t) => {
  const f = await fixture(t);
  f.setProviders(["claude", "fixture"]);
  f.settings.update("alice", {
    set: { default_provider: "claude", max_runtime_minutes: 7 },
  });
  const persisted = f.stored();
  f.setProviders(["fixture", "codex"]);
  f.reopen();
  assert.equal(f.settings.read("alice").values.default_provider, "fixture");
  assert.equal(
    f.settings.taskInput("alice", { title: "Review", description: "Review" })
      .provider,
    "fixture",
  );
  assert.deepEqual(
    f.settings.read("alice").schema.properties!.default_provider.enum,
    ["fixture", "codex"],
  );
  assert.deepEqual(f.stored(), persisted);
  f.setProviders(["claude", "fixture"]);
  assert.equal(f.settings.read("alice").values.default_provider, "claude");
  assert.equal(f.settings.values("alice").max_runtime_minutes, 7);
  assert.deepEqual(f.stored(), persisted);
});

test("legacy null budget updates remain compatible and validation is atomic", async (t) => {
  const f = await fixture(t);
  f.settings.update("alice", { set: { max_cost_usd: 13 } });
  f.settings.update("alice", { set: { max_cost_usd: null } });
  assert.equal(f.settings.read("alice").values.use_cost_budget, false);
  assert.equal(f.settings.read("alice").values.max_cost_usd, 13);
  const original = f.settings.read("alice");
  for (const set of [
    { default_provider: "claude", max_runtime_minutes: 10 },
    { use_cost_budget: true, max_cost_usd: 0 },
    { max_runtime_minutes: 121 },
    { use_cost_budget: "yes" },
    { unknown: true },
    {},
  ]) {
    assert.throws(() => f.settings.update("alice", { set }));
    assert.deepEqual(f.settings.read("alice"), original);
  }
  f.reopen();
  f.settings.update("alice", { set: { use_cost_budget: true } });
  assert.equal(f.settings.values("alice").max_cost_usd, 13);
});
