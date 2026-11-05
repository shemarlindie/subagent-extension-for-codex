import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test, type TestContext, vi } from "vitest";

import { Store } from "../tasks/storage/store.js";
import { Settings } from "./settings.js";
import { saveSettingsFile } from "./settings-file.js";

function useHomeFolder(folder: string) {
  vi.stubEnv("HOME", folder);
  vi.stubEnv("USERPROFILE", folder);
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "settings-file-"));
  const store = new Store(join(directory, "settings.sqlite"));
  useHomeFolder(directory);

  t.onTestFinished(async () => {
    vi.unstubAllEnvs();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    directory,
    settings: new Settings(store.database, () => ["claude"]),
  };
}

test("parallel exports create private distinct files in the home folder containing the saved defaults", async (t) => {
  const { directory, settings } = await fixture(t);

  settings.update("source", {
    set: {
      task: {
        worktree_branch_prefix: "exported/",
        budget: { max_cost_usd: { enabled: false, amount: 17 } },
      },
      providers: { claude: { settings_files: false, user_mcp: false } },
    },
  });

  const [first, second] = await Promise.all([
    saveSettingsFile(settings, "source"),
    saveSettingsFile(settings, "source"),
  ]);

  expect(dirname(first.path)).toBe(directory);
  expect(first.path).not.toBe(second.path);
  const document = await readFile(first.path, "utf8");
  expect(await readFile(second.path, "utf8")).toBe(document);

  expect(JSON.parse(document)).toMatchObject({
    format: 2,
    settings: {
      task: {
        worktree_branch_prefix: "exported/",
        budget: { max_cost_usd: { enabled: false, amount: 17 } },
      },
      providers: { claude: { settings_files: false, user_mcp: false } },
    },
  });

  if (process.platform !== "win32") {
    expect((await stat(first.path)).mode & 0o777).toBe(0o600);
  }

  // A subsequent export leaves the earlier file exactly as the user saved it.
  await writeFile(first.path, "earlier export");

  const third = await saveSettingsFile(settings, "source");

  expect(third.path).not.toBe(first.path);
  expect(await readFile(first.path, "utf8")).toBe("earlier export");
});

test("a home folder that cannot hold files reports failure", async (t) => {
  const { directory, settings } = await fixture(t);
  const blocked = join(directory, "not-a-directory");
  await writeFile(blocked, "keep this file");
  useHomeFolder(blocked);

  await expect(saveSettingsFile(settings, "source")).rejects.toThrow();

  expect(await readFile(blocked, "utf8")).toBe("keep this file");
});
