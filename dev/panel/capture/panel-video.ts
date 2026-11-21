// Records the dev host's panel as a 2x MP4. See
// docs/ui-verification.md#recordings.
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { FrameLocator, Locator, Page } from "@playwright/test";

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

/** Opens a dev host path, such as `/?display=fullscreen&dw_task=<id>`. */
export async function withPanel(
  path: string,
  script: (session: PanelSession) => Promise<unknown>,
) {
  const server = await devServer("/");
  const browser = await launchBrowser();

  try {
    // Lays the host out at 1x in the viewport the zoomed page fills.
    const page = await browser.newPage({
      viewport: {
        width: VIEWPORT.width / ZOOM,
        height: VIEWPORT.height / ZOOM,
      },
    });

    const iframe = page.locator(".frame iframe");
    const panel = page.frameLocator(".frame iframe");
    await page.goto(`${ORIGIN}${path}`);
    await panel.locator("body *").first().waitFor();
    await page.waitForTimeout(1000);

    // The zoomed host still takes its height from the viewport, which would
    // push the composer off-screen, so the iframe keeps its 1x height.
    await iframe.evaluate((element: HTMLElement) => {
      element.style.height = `${element.getBoundingClientRect().height}px`;
    });

    await page.setViewportSize(VIEWPORT);

    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, ZOOM);

    const box = await iframe.boundingBox();
    if (!box) throw new Error("The panel iframe has no layout box");

    // H.264 in 4:2:0 needs even sizes.
    const even = (value: number) => Math.floor(value / 2) * 2;
    const crop = `crop=${even(box.width)}:${even(box.height)}:${even(box.x)}:${even(box.y)}`;

    await script({
      page,
      panel,
      center: async (element) => {
        const rect = await element.evaluate((node) =>
          node.getBoundingClientRect().toJSON(),
        );

        return {
          x: box.x + (rect.x + rect.width / 2) * ZOOM,
          y: box.y + (rect.y + rect.height / 2) * ZOOM,
        };
      },
      record: async (out, actions) => {
        const file = resolve(out);
        const frames = `${file}-frames`;
        const result = await capturePngFrames(page, frames, VIEWPORT, actions);

        // The showcase MP4 settings, cropped to the panel.
        await promisify(execFile)("ffmpeg", [
          ...["-y", "-v", "error", "-safe", "0", "-f", "concat"],
          ...["-i", join(frames, "frames.ffconcat")],
          ...["-vf", `${crop},fps=60,format=yuv420p`],
          ...["-c:v", "libx264", "-preset", "slow", "-tune", "animation"],
          ...["-crf", "12", "-movflags", "+faststart", "-an", file],
        ]);

        await rm(frames, { recursive: true });
        console.log(`${out} (${result})`);
      },
    });
  } finally {
    await browser.close();
    await server?.close();
  }
}
