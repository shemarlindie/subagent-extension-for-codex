import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vitest";

import { claudePathVariable } from "./executable.js";
import { claudeUpgradeInfo } from "./upgrade.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-upgrade-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 1\n");
  await chmod(path, 0o755);

  return path;
}

async function link(path: string, target: string) {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path);

  return path;
}

const environment = (launcher: string, override = false) => ({
  platform: "darwin" as const,
  env: override
    ? { [claudePathVariable]: launcher }
    : { PATH: dirname(launcher) },
});

test.skipIf(process.platform === "win32")(
  "Homebrew targets the matching prefix and cask, including latest and quoted paths",
  async () => {
    for (const cask of ["claude-code", "claude-code@latest"]) {
      const prefix = join(root, "brew's prefix", cask),
        binary = await file(
          join(prefix, "Caskroom", cask, "2.1.319", "claude"),
        ),
        launcher = await link(join(prefix, "bin", "claude"), binary),
        manager = await file(join(prefix, "bin", "brew"));

      const info = await claudeUpgradeInfo(binary, environment(launcher));

      expect(info.command).toBe(
        `'${root}/brew'\\''s prefix/${cask}/bin/brew' upgrade --cask ${cask}`,
      );

      // Both casks share the same launcher and manager checks.
      if (cask === "claude-code") continue;

      expect(
        (await claudeUpgradeInfo(binary, environment(binary, true))).command,
      ).toBeUndefined();

      await rm(manager);

      expect(
        (await claudeUpgradeInfo(binary, environment(launcher))).command,
      ).toBeUndefined();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "native updates use the standard launcher and refuse version-pinned overrides",
  async () => {
    const binary = await file(
        join(root, ".local", "share", "claude", "versions", "2.1.319"),
      ),
      launcher = await link(join(root, ".local", "bin", "claude"), binary);

    const info = await claudeUpgradeInfo(binary, environment(launcher), root);
    expect(info.command).toBe(`'${launcher}' update`);

    expect(
      (await claudeUpgradeInfo(binary, environment(binary, true), root))
        .command,
    ).toBeUndefined();
  },
);
