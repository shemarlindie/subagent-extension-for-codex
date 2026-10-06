import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { Store } from "../tasks/store.js";
import { configuredProviders } from "./config.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ac-provider-config-"));

  return { dir, store: new Store(join(dir, "db.sqlite")) };
}

test("Codex service registration is opt-in", async () => {
  const { dir, store } = await setup();

  try {
    assert.deepEqual(
      [...configuredProviders(store, dir, {}).keys()],
      ["claude"],
    );

    assert.throws(
      () =>
        configuredProviders(store, dir, {
          CODEX_SUBAGENT_EXTENSION_PROVIDER: "typo",
        }),
      /must be/,
    );
  } finally {
    store.close();
  }
});

test(
  "opt-in Codex configuration requires explicit model, executable and distinct credential roles",
  { skip: process.platform !== "darwin" },
  async () => {
    const { dir, store } = await setup();

    try {
      const config = {
        CODEX_SUBAGENT_EXTENSION_CODEX: "1",
        CODEX_SUBAGENT_EXTENSION_CODEX_MODEL: "configured-model",
        CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE: join(dir, "codex"),
        OPENAI_API_KEY: "test-application-key",
        OPENAI_EXECUTOR_API_KEY: "test-restricted-key",
      };

      for (const key of [
        "CODEX_SUBAGENT_EXTENSION_CODEX_MODEL",
        "CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE",
        "OPENAI_API_KEY",
        "OPENAI_EXECUTOR_API_KEY",
      ])
        assert.throws(() =>
          configuredProviders(store, dir, { ...config, [key]: undefined }),
        );

      assert.throws(
        () =>
          configuredProviders(store, dir, {
            ...config,
            CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE: "codex",
          }),
        /absolute native Codex executable path/,
      );

      assert.throws(
        () =>
          configuredProviders(store, dir, {
            ...config,
            OPENAI_EXECUTOR_API_KEY: config.OPENAI_API_KEY,
          }),
        /must not be reused/,
      );

      const providers = configuredProviders(store, dir, config);
      assert.deepEqual([...providers.keys()], ["claude", "codex"]);
      assert.equal(providers.get("codex")?.capabilities.cost_budget, false);
      await providers.get("codex")?.close?.();

      const only = configuredProviders(store, dir, {
        ...config,
        CODEX_SUBAGENT_EXTENSION_PROVIDER: "codex",
      });

      assert.deepEqual([...only.keys()], ["codex"]);
      await only.get("codex")?.close?.();
    } finally {
      store.close();
    }
  },
);
