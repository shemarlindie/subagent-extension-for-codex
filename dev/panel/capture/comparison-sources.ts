// What each side of a comparison serves: overlaid files and the fixture clock.
import { execFile } from "node:child_process";
import {
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

import type { Page } from "@playwright/test";
import type { Plugin } from "vite";

import { withCleanup } from "./capture-cleanup";

/**
 * What a side records. Without one, a side serves the working tree.
 *
 * - `ref` or `folder` with `paths` replaces those repository files with their
 *   content at the Git ref, or with the files at the same paths in the folder.
 * - `checkout` serves another checkout of the repository, such as a worktree.
 * - `origin` records a panel dev host that is already running.
 */
export type ComparisonSource =
  | { ref: string; paths: string[] }
  | { folder: string; paths: string[] }
  | { checkout: string }
  | { origin: string };

type FileSource = Extract<ComparisonSource, { paths: string[] }>;

export type FixtureClock = {
  /** Fixture time in milliseconds while the page loads and before playback. */
  startMs: number;
  /** Fixture milliseconds per real millisecond. The default is 1. */
  speed?: number;
};

const run = promisify(execFile);

const git = async (...args: string[]) => (await run("git", args)).stdout.trim();

// A worktree's linked node_modules is a file, which `node_modules/` doesn't ignore.
export const checkoutState = async (dir: string) => ({
  commit: await git("-C", dir, "rev-parse", "HEAD"),
  dirty:
    (await git("-C", dir, "status", "--porcelain", "--", ":!node_modules")) !==
    "",
});

/** Reads a source's files, keyed by repository path. */
export async function readOverlay(source: FileSource) {
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
 * Type-checks the project with `files` in place, in a copy of the working
 * tree. Vite skips type checks, so a stale overlay would only fail in the
 * browser.
 */
export async function typeCheckOverlay(files: Map<string, string>) {
  const copy = await mkdtemp(join(tmpdir(), "comparison-types-"));

  await withCleanup(
    async () => {
      const deleted = new Set((await git("ls-files", "-d")).split("\n"));
      const tree = await git("ls-files", "-co", "--exclude-standard");

      for (const path of tree.split("\n")) {
        if (!deleted.has(path)) await cp(path, join(copy, path));
      }

      await symlink(resolve("node_modules"), join(copy, "node_modules"));

      for (const [path, code] of files) {
        await writeFile(join(copy, path), code);
      }

      await run("npm", ["run", "-s", "typecheck:source"], {
        cwd: copy,
      }).catch((error: { stdout?: string }) => {
        throw new Error(`The swapped files fail type checks:\n${error.stdout}`);
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
const ELAPSED = "Date.now() - startedAt";

/** Starts playing the fixture clock in the dev host page. */
export const startFixtureClock = (page: Page) =>
  page.evaluate((name) => {
    Object.assign(globalThis, { [name]: performance.now() });
  }, CLOCK_START);

/**
 * Holds the live fixtures at `startMs` until the page sets the clock start,
 * then plays them at `speed` for `playMs` and holds the last frame. `root` is
 * the checkout the dev host serves.
 */
export function fixtureClockPlugin(
  { startMs, speed = 1 }: FixtureClock,
  playMs: number,
  root = ".",
) {
  const livePreview = resolve(root, "dev/panel/scenarios/live-preview.ts");
  const played = `Math.min(${playMs}, (performance.now() - globalThis.${CLOCK_START}) * ${speed})`;

  return {
    name: "comparison-fixture-clock",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== livePreview) return;

      if (!code.includes(ELAPSED)) {
        throw new Error(`${livePreview} doesn't read ${ELAPSED}`);
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
