// What each side of a comparison serves: overlaid files and the fixture clock.
import { execFile } from "node:child_process";
import {
  copyFile,
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { Plugin } from "vite";

import { withCleanup } from "./capture-cleanup";

/**
 * Replaces repository `paths` with their content at a Git `ref`, or with the
 * files at the same relative paths under `folder`. Without one, a side serves
 * the working tree.
 */
export type ComparisonSource =
  { ref: string; paths: string[] } | { folder: string; paths: string[] };

export type FixtureClock = {
  /** Fixture time in milliseconds while the page loads and before playback. */
  startMs: number;
  /** Fixture milliseconds per real millisecond. The default is 1. */
  speed?: number;
};

const run = promisify(execFile);

export const git = async (...args: string[]) =>
  (await run("git", args)).stdout.trim();

// The panel project type-checks overlays. Other code is beyond its reach.
const OVERLAY_ROOTS = ["src/panel/", "src/shared/"];

/** Reads a source's files, keyed by repository path. */
export async function readOverlay(source: ComparisonSource) {
  const outside = source.paths.filter(
    (path) => !OVERLAY_ROOTS.some((root) => path.startsWith(root)),
  );

  if (outside.length > 0) {
    throw new Error(
      `Overlays cover files in ${OVERLAY_ROOTS.join(" and ")}: ${outside.join(", ")}`,
    );
  }

  const commit =
    "ref" in source
      ? await git("rev-parse", "--verify", `${source.ref}^{commit}`)
      : undefined;

  const read = async (path: string) =>
    "folder" in source
      ? readFile(join(source.folder, path), "utf8")
      : (await run("git", ["show", `${commit}:${path}`])).stdout;

  const files = new Map(
    await Promise.all(
      source.paths.map(async (path) => [path, await read(path)] as const),
    ),
  );

  return { commit, files };
}

/**
 * Type-checks the panel with `files` in place, in a copy of `src`. Vite skips
 * type checks, so a stale overlay would only fail in the browser.
 */
export async function typeCheckOverlay(files: Map<string, string>) {
  const copy = await mkdtemp(join(tmpdir(), "comparison-types-"));

  await withCleanup(
    async () => {
      await cp("src", join(copy, "src"), { recursive: true });
      await copyFile("tsconfig.panel.json", join(copy, "tsconfig.panel.json"));
      await copyFile("package.json", join(copy, "package.json"));
      await symlink(resolve("node_modules"), join(copy, "node_modules"));

      for (const [path, code] of files) {
        await writeFile(join(copy, path), code);
      }

      await run(
        resolve("node_modules/.bin/tsc"),
        ["-p", "tsconfig.panel.json"],
        {
          cwd: copy,
        },
      ).catch((error: { stdout?: string }) => {
        throw new Error(`The overlay fails type checks:\n${error.stdout}`);
      });
    },
    () => rm(copy, { recursive: true, force: true }),
  );
}

/** Serves `files` in place of the repository's, and records which loaded. */
export function overlayPlugin(files: Map<string, string>, loaded: Set<string>) {
  const byId = new Map([...files.keys()].map((path) => [resolve(path), path]));

  return {
    name: "comparison-overlay",
    enforce: "pre",
    load(id) {
      const path = byId.get(id.split("?")[0] ?? id);
      if (path === undefined) return;

      loaded.add(path);

      return { code: files.get(path) ?? "", map: null };
    },
  } satisfies Plugin;
}

export const CLOCK_START = "__comparisonClockStart";
const LIVE_PREVIEW = resolve("dev/panel/scenarios/live-preview.ts");
const ELAPSED = "Date.now() - startedAt";

/**
 * Holds the live fixtures at `startMs` until the page sets the clock start,
 * then plays them at `speed` for `playMs` and holds the last frame.
 */
export function fixtureClockPlugin(
  { startMs, speed = 1 }: FixtureClock,
  playMs: number,
) {
  const played = `Math.min(${playMs}, (performance.now() - globalThis.${CLOCK_START}) * ${speed})`;

  return {
    name: "comparison-fixture-clock",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== LIVE_PREVIEW) return;

      if (!code.includes(ELAPSED)) {
        throw new Error(`live-preview.ts no longer reads ${ELAPSED}`);
      }

      return {
        code: code.replace(
          ELAPSED,
          `(${startMs} + (globalThis.${CLOCK_START} === undefined ? 0 : ${played}))`,
        ),
        map: null,
      };
    },
  } satisfies Plugin;
}
