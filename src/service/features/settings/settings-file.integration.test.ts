import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

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

test("an export creates a private file in the home folder containing the saved defaults", async (t) => {
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

  const { path } = await saveSettingsFile(settings, "source");

  expect(dirname(path)).toBe(directory);

  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
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
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }
});

test("exports in the same second leave the earlier file alone, and a later export succeeds", async (t) => {
  const { settings } = await fixture(t);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T09:36:05.100Z"));

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { path } = await saveSettingsFile(settings, "source");

  expect(basename(path)).toBe(
    "delegated-work-settings-2026-11-05T09-36-05Z.json",
  );

  await writeFile(path, "earlier export");

  vi.setSystemTime(new Date("2026-11-05T09:36:05.900Z"));
  await expect(saveSettingsFile(settings, "source")).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("earlier export");

  vi.setSystemTime(new Date("2026-11-05T09:36:06.000Z"));
  const later = await saveSettingsFile(settings, "source");
  expect(later.path).not.toBe(path);
  expect(await readFile(path, "utf8")).toBe("earlier export");
});

test("a home folder that cannot hold files reports failure", async (t) => {
  const { directory, settings } = await fixture(t);
  const blocked = join(directory, "not-a-directory");
  await writeFile(blocked, "keep this file");
  useHomeFolder(blocked);

  await expect(saveSettingsFile(settings, "source")).rejects.toThrow();

  expect(await readFile(blocked, "utf8")).toBe("keep this file");
});
