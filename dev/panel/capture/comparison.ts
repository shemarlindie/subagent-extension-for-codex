// Records one fixture scenario on several versions of the panel and joins them
// side by side. See docs/ui-verification.md#comparison-recordings.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { FrameLocator, Page } from "@playwright/test";

import { devServer, launchBrowser } from "./capture-browser";
import { withCleanup } from "./capture-cleanup";
import { addHeader, headerSamples, type Sample } from "./comparison-header";
import {
  checkoutState,
  CLOCK_START,
  fixtureClockPlugin,
  overlayPlugin,
  readOverlay,
  typeCheckOverlay,
  type ComparisonSource,
  type FixtureClock,
} from "./comparison-sources";
import { concatInput, ENCODING, validateOutputCanvas } from "./panel-mp4";
import { capturePngFrames } from "./screencast";

type Size = { width: number; height: number };

type ComparisonSide = {
  label: string;
  /** A CSS color for the label. */
  color: string;
  source?: ComparisonSource;
};

type Readout = {
  label: string;
  unit?: string;
  /**
   * Reads the running panel every animation frame. It runs in the dev host
   * page, so it can't use anything from the script's scope.
   */
  value: (panel: Window) => number;
};

type ComparisonSession = {
  side: ComparisonSide;
  /** This side's dev host, such as for a probe after `play`. */
  origin: string;
  page: Page;
  panel: FrameLocator;
  /**
   * Records this side, once: a short lead-in, the fixture clock playing while
   * `actions` run, and a hold on the last frame.
   */
  play: (actions?: () => Promise<unknown>) => Promise<void>;
};

type ComparisonOptions = {
  sides: ComparisonSide[];
  /** A dev host path that sets the data, theme and panel view. */
  path: string;
  clock: FixtureClock;
  /** Fixture milliseconds to play. */
  playMs: number;
  /** Folder for `comparison.mp4` and `report.json`. */
  out: string;
  caption?: string;
  readout?: Readout;
  /** Each side's size in CSS pixels, header included. The default is 640 × 900. */
  size?: Size;
  /** Waits for readiness, calls `play`, and returns anything for the report. */
  scenario: (session: ComparisonSession) => Promise<unknown>;
};

type SideReport = {
  label: string;
  source?: ComparisonSource & { commit?: string; dirty?: boolean };
  frames?: string;
  samples?: Sample[];
  errors: string[];
  result?: unknown;
};

const LEAD_MS = 500;
const TAIL_MS = 800;
const DIVIDER = "0xdce2ea";

type Overlay = Awaited<ReturnType<typeof readOverlay>>;

async function recordSide(
  options: ComparisonOptions & { size: Size },
  side: ComparisonSide,
  overlay: Overlay | undefined,
  frames: string,
  report: SideReport,
) {
  const { clock, playMs, readout, size } = options;
  const { source } = side;
  const speed = clock.speed ?? 1;
  const loaded = new Set<string>();
  const root = source && "checkout" in source ? source.checkout : ".";

  // A running dev host keeps its own clock.
  const server =
    source && "origin" in source
      ? { origin: source.origin, close: undefined }
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

    await addHeader(
      page,
      {
        label: side.label,
        color: side.color,
        caption: options.caption,
        readout: readout && { label: readout.label, unit: readout.unit },
        clockStart: CLOCK_START,
        startMs: clock.startMs,
        speed,
        playMs,
      },
      readout?.value,
    );

    let played = false;

    const play = async (actions?: () => Promise<unknown>) => {
      if (played) throw new Error("Call play once per side");
      played = true;

      report.frames = await capturePngFrames(
        page,
        frames,
        async () => {
          await page.waitForTimeout(LEAD_MS);

          await page.evaluate((name) => {
            Object.assign(globalThis, { [name]: performance.now() });
          }, CLOCK_START);

          await Promise.all([actions?.(), page.waitForTimeout(playMs / speed)]);

          await page.waitForTimeout(TAIL_MS);
        },
        size,
      );

      report.samples = await headerSamples(page);

      console.log(`${side.label}: ${report.frames}`);
    };

    report.result = await options.scenario({
      side,
      origin: server.origin,
      page,
      panel,
      play,
    });

    if (report.frames === undefined) {
      throw new Error(`The scenario never played ${side.label}`);
    }

    const unused = [...(overlay?.files.keys() ?? [])].filter(
      (path) => !loaded.has(path),
    );

    if (unused.length > 0) {
      throw new Error(`${side.label} never loaded ${unused.join(", ")}`);
    }
  };

  await withCleanup(
    async () => {
      const browser = await launchBrowser();

      await withCleanup(
        async () =>
          session(
            await browser.newPage({
              viewport: size,
              reducedMotion: "no-preference",
            }),
          ),
        () => browser.close(),
      );
    },
    async () => {
      await server.close?.();
    },
  );
}

async function compose(frames: string[], width: number, file: string) {
  const streams = frames.map(
    (_, index) => `[${index}:v]fps=60,setpts=PTS-STARTPTS[v${index}]`,
  );

  const dividers = frames
    .slice(1)
    .map(
      (_, index) =>
        `drawbox=x=${(index + 1) * width - 1}:y=0:w=2:h=ih:color=${DIVIDER}:t=fill`,
    );

  const joined = `${frames.map((_, index) => `[v${index}]`).join("")}hstack=inputs=${frames.length}:shortest=1`;

  await promisify(execFile)("ffmpeg", [
    ...["-y", "-v", "error", ...frames.flatMap(concatInput)],
    "-filter_complex",
    [...streams, [joined, ...dividers, "format=yuv420p"].join(",")].join(";"),
    ...ENCODING,
    file,
  ]);
}

/**
 * Records `scenario` on each side in turn, each on its own dev host, then
 * writes `comparison.mp4` and `report.json` to `out`. The report is written
 * on failure too, with the error.
 */
export async function withComparison(options: ComparisonOptions) {
  const { sides, out, path, clock, playMs } = options;
  const size = options.size ?? { width: 640, height: 900 };
  validateOutputCanvas(size);

  if (sides.length < 2) throw new Error("A comparison needs two sides");

  const report = {
    path,
    clock,
    playMs,
    size,
    ...(await checkoutState(".")),
    sides: [] as SideReport[],
    error: undefined as string | undefined,
  };

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

  await mkdir(out, { recursive: true });
  const frames = await mkdtemp(join(tmpdir(), "panel-comparison-"));
  const recorded: string[] = [];

  await withCleanup(
    async () => {
      try {
        for (const { side, overlay } of runs) {
          const state =
            side.source && "checkout" in side.source
              ? await checkoutState(side.source.checkout)
              : { commit: overlay?.commit };

          const entry: SideReport = {
            label: side.label,
            source: side.source && { ...side.source, ...state },
            errors: [],
          };

          report.sides.push(entry);
          const dir = join(frames, String(recorded.length));
          await recordSide({ ...options, size }, side, overlay, dir, entry);
          recorded.push(dir);
        }

        await compose(recorded, size.width, join(out, "comparison.mp4"));
      } catch (error) {
        report.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        await writeFile(
          join(out, "report.json"),
          JSON.stringify(report, null, 2),
        );
      }
    },
    () => rm(frames, { recursive: true, force: true }),
  );

  console.log(join(out, "comparison.mp4"));

  return report;
}
