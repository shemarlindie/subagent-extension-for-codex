// Records the dev host's panel as a 2x MP4. See
// docs/ui-verification.md#recordings.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

// The MP4 has one size. Use the area the iframe occupied across the recording
// so a clip can show both the inline preview and the expanded panel.
function watchPanelBounds(iframe: Locator) {
  return iframe.evaluateHandle((element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    const bounds = { left, top, right, bottom };

    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      bounds.left = Math.min(bounds.left, rect.left);
      bounds.top = Math.min(bounds.top, rect.top);
      bounds.right = Math.max(bounds.right, rect.right);
      bounds.bottom = Math.max(bounds.bottom, rect.bottom);
    });

    observer.observe(element);

    return () => {
      observer.disconnect();

      return bounds;
    };
  });
}

async function recordPanel(
  page: Page,
  iframe: Locator,
  out: string,
  actions: () => Promise<unknown>,
) {
  const file = resolve(out);
  const frames = await mkdtemp(join(tmpdir(), "panel-video-"));

  try {
    const watcher = await watchPanelBounds(iframe);
    let bounds;
    let result: string;

    try {
      result = await capturePngFrames(page, frames, VIEWPORT, actions);
    } finally {
      try {
        bounds = await watcher.evaluate((stop) => stop());
      } finally {
        await watcher.dispose();
      }
    }

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
  } finally {
    await rm(frames, { recursive: true, force: true });
  }
}

/** Opens a dev host path, such as `/?display=fullscreen&dw_task=<id>`. */
export async function withPanel(
  path: string,
  script: (session: PanelSession) => Promise<unknown>,
) {
  const server = await devServer("/");
  const browser = await launchBrowser();

  try {
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
  } finally {
    await browser.close();
    await server?.close();
  }
}
