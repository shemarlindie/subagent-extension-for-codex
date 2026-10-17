import type { ChangedFile } from "../../../shared/workspaces/changes.js";
import { readDiff } from "./read-diff.js";
import { buildUncommittedBase } from "./uncommitted-base.js";

/** How many recent diffs are cached, and for how long. */
const DIFF_CACHE_SIZE = 2;
const DIFF_CACHE_MS = 60_000;

/** How many uncommitted-change baselines are cached. */
const BASELINE_CACHE_SIZE = 16;

/**
 * Recent diffs and uncommitted-change baselines, by their inputs. Paged reads
 * ask for the same trees again.
 */
export class ChangeCache {
  /**
   * What uncommitted changes since `start` are measured from: the `start`
   * snapshot, except files committed since (those that differ between
   * `headThen`, the commit HEAD was on at `start`, and the tree HEAD has
   * now), taken as HEAD has them now. Edits already uncommitted at `start`
   * are left out, and so is anything committed after it. Its inputs never
   * change, so recent ones are cached: every page and preview reads the same.
   */
  baseline(
    root: string,
    cwd: string,
    start: string,
    headThen: string,
    headNow: string,
  ) {
    const key = `${cwd}\0${start}\0${headThen}\0${headNow}`,
      cached = this.baselines.get(key);

    if (cached) return cached;

    const base = buildUncommittedBase(root, cwd, start, headThen, headNow);

    this.baselines.set(key, base);

    // A failed build isn't kept, so the next read tries again.
    base.catch(() => {
      if (this.baselines.get(key) === base) this.baselines.delete(key);
    });

    // Maps keep insertion order, so the first entries are the oldest.
    for (const entry of this.baselines.keys()) {
      if (this.baselines.size > BASELINE_CACHE_SIZE) {
        this.baselines.delete(entry);
      }
    }

    return base;
  }

  /** Recent baselines by their inputs; each is only a tree id. */
  private baselines = new Map<string, Promise<string>>();

  /**
   * Recent diffs by checkout and tree pair. Reading a large diff page by page
   * asks for the same pair once per page; trees never change, so a cached
   * diff is always exact, and a refresh with no new edits also snapshots to
   * the same tree. Only a few are kept, briefly, since each holds a whole
   * diff in memory. Entries are promises, so concurrent reads share one run.
   */
  private diffs = new Map<
    string,
    {
      expires: number;
      diff: Promise<{ files: ChangedFile[]; parts: string[] }>;
    }
  >();

  /** The file list and the per-file diff between two trees, cached. */
  diff(cwd: string, base: string, current: string) {
    const key = `${cwd}\0${base}\0${current}`,
      now = Date.now();

    for (const [entry, { expires }] of this.diffs) {
      if (expires <= now) this.diffs.delete(entry);
    }

    const cached = this.diffs.get(key);
    if (cached) return cached.diff;

    const diff = readDiff(cwd, base, current);
    this.diffs.set(key, { expires: now + DIFF_CACHE_MS, diff });

    // A failed read isn't kept, so the next request tries again; a newer
    // entry for the same pair, stored after this one expired, stays.
    diff.catch(() => {
      if (this.diffs.get(key)?.diff === diff) this.diffs.delete(key);
    });

    // Maps keep insertion order, so the first entries are the oldest.
    for (const entry of this.diffs.keys()) {
      if (this.diffs.size > DIFF_CACHE_SIZE) this.diffs.delete(entry);
    }

    return diff;
  }
}
