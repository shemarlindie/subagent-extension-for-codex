// Records the dev host's panel as a 2x MP4. See
// docs/ui-verification.md#recordings.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import type { FrameLocator, Locator, Page } from "@playwright/test";

import { withCleanup } from "./capture-cleanup";
import {
  capturePngFrames,
  devServer,
  launchBrowser,
  ORIGIN,
} from "./screencast";

// The screencast captures CSS pixels whatever the device scale, so the page
// zooms to 2x in a viewport twice the size.
const ZOOM = 2;
const VIEWPORT = { width: 1600, height: 1280 };

type PanelSession = {
  page: Page;
  panel: FrameLocator;
  /**
   * An element's center for `page.mouse`. Playwright places elements in the
   * zoomed iframe as if unzoomed, so its own clicks and hovers miss.
   */
  center: (element: Locator) => Promise<{ x: number; y: number }>;
  /** Records the panel while `actions` runs, and writes the MP4 to `out`. */
  record: (out: string, actions: () => Promise<unknown>) => Promise<void>;
};

// The MP4 has one size. Sample each animation frame to include moves such as
// opening the inspector, which can shift the iframe without resizing it.
function watchPanelBounds(iframe: Locator) {
  return iframe.evaluateHandle((element) => {
    const frame = element.parentElement;
    const { left, top, right, bottom } = element.getBoundingClientRect();
    const bounds = { left, top, right, bottom };
    let frameId: number;

    const watcher = {
      sample(this: void) {
        const rect = frame?.querySelector("iframe")?.getBoundingClientRect();

        if (rect?.width && rect.height) {
          bounds.left = Math.min(bounds.left, rect.left);
          bounds.top = Math.min(bounds.top, rect.top);
          bounds.right = Math.max(bounds.right, rect.right);
          bounds.bottom = Math.max(bounds.bottom, rect.bottom);
        }

        frameId = requestAnimationFrame(watcher.sample);
      },
      bounds,
      stop() {
        cancelAnimationFrame(frameId);
      },
    };

    frameId = requestAnimationFrame(watcher.sample);

    return watcher;
  });
}

async function capturePanelFrames(
  page: Page,
  iframe: Locator,
  frames: string,
  actions: () => Promise<unknown>,
) {
  const watcher = await watchPanelBounds(iframe);

  return withCleanup(
    async () => {
      const result = await withCleanup(
        () => capturePngFrames(page, frames, VIEWPORT, actions),
        () => watcher.evaluate((capture) => capture.stop()),
      );

      const bounds = await watcher.evaluate((capture) => capture.bounds);

      return { result, bounds };
    },
    () => watcher.dispose(),
  );
}

async function recordPanel(
  page: Page,
  iframe: Locator,
  out: string,
  actions: () => Promise<unknown>,
) {
  const file = resolve(out);
  const frames = await mkdtemp(join(tmpdir(), "panel-video-"));

  await withCleanup(
    async () => {
      const { result, bounds } = await capturePanelFrames(
        page,
        iframe,
        frames,
        actions,
      );

      // H.264 in 4:2:0 needs even sizes.
      const even = (value: number) => Math.floor(value / 2) * 2;
      const x = even(Math.max(0, bounds.left));
      const y = even(Math.max(0, bounds.top));
      const width = even(Math.min(VIEWPORT.width, bounds.right)) - x;
      const height = even(Math.min(VIEWPORT.height, bounds.bottom)) - y;
      const crop = `crop=${width}:${height}:${x}:${y}`;

      // The showcase MP4 settings, cropped to the panel.
      await mkdir(dirname(file), { recursive: true });

      await promisify(execFile)("ffmpeg", [
        ...["-y", "-v", "error", "-safe", "0", "-f", "concat"],
        ...["-i", join(frames, "frames.ffconcat")],
        ...["-vf", `${crop},fps=60,format=yuv420p`],
        ...["-c:v", "libx264", "-preset", "slow", "-tune", "animation"],
        ...["-crf", "12", "-movflags", "+faststart", "-an", file],
      ]);

      console.log(`${out} (${result})`);
    },
    () => rm(frames, { recursive: true, force: true }),
  );
}

/** Opens a dev host path, such as `/?display=fullscreen&dw_task=<id>`. */
export async function withPanel(
  path: string,
  script: (session: PanelSession) => Promise<unknown>,
) {
  const server = await devServer("/");

  await withCleanup(
    async () => {
      const browser = await launchBrowser();

      await withCleanup(
        async () => {
          const page = await browser.newPage({ viewport: VIEWPORT });

          const iframe = page.locator(".frame iframe");
          const panel = page.frameLocator(".frame iframe");
          await page.goto(`${ORIGIN}${path}`);

          // Keep the zoomed host within the viewport so the iframe can resize with
          // the inline and fullscreen layouts.
          await page.addStyleTag({
            content: `:root { zoom: ${ZOOM}; } .host { height: ${VIEWPORT.height / ZOOM}px; }`,
          });

          await panel.locator("body *").first().waitFor();
          await page.waitForTimeout(1000);

          await script({
            page,
            panel,
            center: async (element) => {
              const box = await iframe.boundingBox();
              if (!box) throw new Error("The panel iframe has no layout box");

              const rect = await element.evaluate((node) =>
                node.getBoundingClientRect().toJSON(),
              );

              return {
                x: box.x + (rect.x + rect.width / 2) * ZOOM,
                y: box.y + (rect.y + rect.height / 2) * ZOOM,
              };
            },
            record: (out, actions) => recordPanel(page, iframe, out, actions),
          });
        },
        () => browser.close(),
      );
    },
    async () => {
      await server?.close();
    },
  );
}
