// Records one fixture scenario on several versions of the panel and joins them
// side by side. See docs/ui-verification.md#comparison-recordings.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";

import { devServer, withBrowser, type CaptureServer } from "./capture-browser";
import { withCleanup } from "./capture-cleanup";
import { composeComparison, type Recorded } from "./comparison-compose";
import {
  addHeader,
  headerSamples,
  type Readout,
  type Sample,
} from "./comparison-header";
import {
  checkoutState,
  fixtureClockPlugin,
  overlayPlugin,
  readOverlay,
  startFixtureClock,
  typeCheckOverlay,
  type ComparisonSource,
  type FixtureClock,
} from "./comparison-sources";
import { validateOutputCanvas } from "./panel-mp4";
import { capturePngFrames } from "./screencast";

type Size = { width: number; height: number };

type ComparisonSide = {
  label: string;
  /** A CSS color for the label. */
  color: string;
  /** A line under the label. */
  note?: string;
  source?: ComparisonSource;
};

type ComparisonSession = {
  side: ComparisonSide;
  /** This side's dev host, such as for a probe after `play`. */
  origin: string;
  page: Page;
  panel: FrameLocator;
  /**
   * Records this side for `comparison.mp4`, once: a short lead-in, the fixture
   * clock playing while `actions` run, and a hold on the last frame.
   */
  play: (actions?: () => Promise<unknown>) => Promise<void>;
  /**
   * Screenshots this side for `<name>.png`, `comparison.png` by default. Every
   * side takes the same stills.
   */
  still: (name?: string) => Promise<void>;
};

type ComparisonOptions = {
  sides: ComparisonSide[];
  /** A dev host path that sets the data, theme and panel view. */
  path: string;
  clock: FixtureClock;
  /** Fixture milliseconds to play. The default is 0, for interactions only. */
  playMs?: number;
  /** CSS animation and transition speed, such as 0.25 for slow motion. */
  animationSpeed?: number;
  /** Folder for the video, stills and `report.json`. */
  out: string;
  /** A line under every side's label and note. */
  caption?: string;
  readouts?: Readout[];
  /** Each side's size in CSS pixels, header included. The default is 640 × 900. */
  size?: Size;
  /**
   * Waits for readiness, calls `play` or `still`, and returns anything for the
   * report.
   */
  scenario: (session: ComparisonSession) => Promise<unknown>;
};

type SideReport = {
  label: string;
  source?: ComparisonSource & { commit?: string; dirty?: boolean };
  frames?: string;
  stills: string[];
  samples?: Sample[];
  errors: string[];
  result?: unknown;
};

const LEAD_MS = 500;
const TAIL_MS = 800;

type Overlay = Awaited<ReturnType<typeof readOverlay>>;

async function recordSide(
  options: ComparisonOptions & { size: Size; playMs: number },
  side: ComparisonSide,
  overlay: Overlay | undefined,
  dir: string,
  report: SideReport,
) {
  const { clock, size, playMs } = options;
  const { source } = side;
  const speed = clock.speed ?? 1;
  const loaded = new Set<string>();
  const root = source && "checkout" in source ? source.checkout : ".";

  // A running dev host keeps its own clock.
  const server: CaptureServer =
    source && "origin" in source
      ? { origin: source.origin }
      : await devServer(
          "/",
          [
            fixtureClockPlugin(clock, playMs, root),
            ...(overlay ? [overlayPlugin(overlay.files, loaded)] : []),
          ],
          root,
        );

  const session = async (page: Page) => {
    page.on("pageerror", (error) => report.errors.push(error.message));
    const panel = page.frameLocator(".frame iframe");
    await page.goto(`${server.origin}${options.path}`);
    await panel.locator("body *").first().waitFor();

    if (options.animationSpeed !== undefined) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Animation.enable");

      await cdp.send("Animation.setPlaybackRate", {
        playbackRate: options.animationSpeed,
      });
    }

    await addHeader(
      page,
      {
        label: side.label,
        note: side.note,
        color: side.color,
        caption: options.caption,
        titles: options.sides.map(({ label, note }) => ({ label, note })),
        startMs: clock.startMs,
        speed,
        playMs,
      },
      options.readouts ?? [],
    );

    let played = false;

    const play = async (actions?: () => Promise<unknown>) => {
      if (played) throw new Error("Call play once per side");
      played = true;

      report.frames = await capturePngFrames(
        page,
        join(dir, "frames"),
        async () => {
          await page.waitForTimeout(LEAD_MS);
          await startFixtureClock(page);
          await Promise.all([actions?.(), page.waitForTimeout(playMs / speed)]);

          await page.waitForTimeout(TAIL_MS);
        },
        size,
      );

      report.samples = await headerSamples(page);

      console.log(`${side.label}: ${report.frames}`);
    };

    const still = async (name = "comparison") => {
      if (report.stills.includes(name)) {
        throw new Error(`${side.label} took ${name} twice`);
      }

      // Lets transitions settle, such as a tab indicator sliding into place.
      await panel.locator("body").evaluate(() =>
        Promise.allSettled(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().endTime !== Infinity,
            )
            .map((animation) => animation.finished),
        ),
      );

      await page.screenshot({ path: join(dir, `${name}.png`) });
      report.stills.push(name);
    };

    report.result = await options.scenario({
      side,
      origin: server.origin,
      page,
      panel,
      play,
      still,
    });

    if (report.frames === undefined && report.stills.length === 0) {
      throw new Error(`The scenario never recorded ${side.label}`);
    }

    const unused = [...(overlay?.files.keys() ?? [])].filter(
      (path) => !loaded.has(path),
    );

    if (unused.length > 0) {
      throw new Error(`${side.label} never loaded ${unused.join(", ")}`);
    }
  };

  await withBrowser(server, async (browser) =>
    session(
      await browser.newPage({ viewport: size, reducedMotion: "no-preference" }),
    ),
  );
}

/**
 * Records `scenario` on each side in turn, each on its own dev host, then
 * writes `comparison.mp4`, the stills and `report.json` to `out`. The report
 * is written on failure too, with the error.
 */
export async function withComparison(options: ComparisonOptions) {
  const { sides, out, path, clock, animationSpeed } = options;
  const playMs = options.playMs ?? 0;
  const size = options.size ?? { width: 640, height: 900 };

  const report = {
    path,
    clock,
    playMs,
    animationSpeed,
    size,
    commit: undefined as string | undefined,
    dirty: undefined as boolean | undefined,
    sides: [] as SideReport[],
    error: undefined as string | undefined,
  };

  await mkdir(out, { recursive: true });

  try {
    validateOutputCanvas(size);
    if (sides.length < 2) throw new Error("A comparison needs two sides");
    Object.assign(report, await checkoutState("."));

    // Overlays fail here, before anything records.
    const runs: { side: ComparisonSide; overlay?: Overlay }[] = [];

    for (const side of sides) {
      const overlay =
        side.source && "paths" in side.source
          ? await readOverlay(side.source)
          : undefined;

      if (overlay) await typeCheckOverlay(overlay.files);
      runs.push({ side, overlay });
    }

    const recordings = await mkdtemp(join(tmpdir(), "panel-comparison-"));
    const recorded: Recorded[] = [];

    await withCleanup(
      async () => {
        for (const { side, overlay } of runs) {
          const state =
            side.source && "checkout" in side.source
              ? await checkoutState(side.source.checkout)
              : { commit: overlay?.commit };

          const entry: SideReport = {
            label: side.label,
            source: side.source && { ...side.source, ...state },
            stills: [],
            errors: [],
          };

          report.sides.push(entry);
          const dir = join(recordings, String(recorded.length));
          await mkdir(dir);

          await recordSide(
            { ...options, size, playMs },
            side,
            overlay,
            dir,
            entry,
          );

          recorded.push({
            dir,
            played: entry.frames !== undefined,
            stills: entry.stills,
          });
        }

        await composeComparison(recorded, size.width, out);
      },
      () => rm(recordings, { recursive: true, force: true }),
    );
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  }

  console.log(out);

  return report;
}
