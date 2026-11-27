// Records the dev host's panel as an MP4. See docs/ui-verification.md#recordings.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FrameLocator, Locator, Page } from "@playwright/test";

import {
  cropWithinViewport,
  rectangleBounds,
  watchBounds,
} from "./capture-bounds";
import { devServer, withBrowser } from "./capture-browser";
import { withCleanup } from "./capture-cleanup";
import { applyPanelLayout, panelLayout, type PanelSetup } from "./panel-layout";
import {
  encodePanelMp4,
  validateOutputCanvas,
  type CaptureRect,
  type OutputCanvas,
} from "./panel-mp4";
import { capturePngFrames } from "./screencast";

type RecordingOptions = {
  /** Defaults to the whole panel. Rectangles use top-level capture pixels. */
  target?: Locator | CaptureRect;
  /** Defaults to the size of the captured area. */
  output?: OutputCanvas;
};

type PanelSession = {
  page: Page;
  panel: FrameLocator;
  /**
   * An element's center for `page.mouse`. Playwright places elements in the
   * zoomed iframe as if unzoomed, so its own clicks and hovers miss.
   */
  center: (element: Locator) => Promise<{ x: number; y: number }>;
  record: (
    out: string,
    actions: () => Promise<unknown>,
    options?: RecordingOptions,
  ) => Promise<void>;
};

async function captureTarget(
  locator: Locator,
  followIframe: boolean,
  capture: () => Promise<string>,
) {
  const watcher = await watchBounds(locator, followIframe);

  return withCleanup(
    async () => {
      const result = await withCleanup(capture, () =>
        watcher.evaluate((watcher) => watcher.stop()),
      );

      const bounds = await watcher.evaluate((watcher) => watcher.bounds);

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
  { target, output }: RecordingOptions,
) {
  if (output) validateOutputCanvas(output);

  const viewport = page.viewportSize();

  if (!viewport) {
    throw new Error("Set a browser viewport before recording an MP4");
  }

  const selected = target ?? iframe;
  const frames = await mkdtemp(join(tmpdir(), "panel-video-"));

  await withCleanup(
    async () => {
      const capture = () => capturePngFrames(page, frames, actions, viewport);
      let result: string;
      let crop: CaptureRect;

      if ("width" in selected) {
        crop = cropWithinViewport(rectangleBounds(selected), viewport);
        result = await capture();
      } else {
        const captured = await captureTarget(
          selected,
          target === undefined,
          capture,
        );

        result = captured.result;
        crop = cropWithinViewport(captured.bounds, viewport);
      }

      await encodePanelMp4(frames, out, crop, output);
      console.log(`${out} (${result})`);
    },
    () => rm(frames, { recursive: true, force: true }),
  );
}

/** Opens a dev host path, such as `/?display=fullscreen&dw_task=<id>`. */
export async function withPanel(
  path: string,
  script: (session: PanelSession) => Promise<unknown>,
  setup: PanelSetup = {},
) {
  const layout = panelLayout(setup);
  const server = await devServer("/");

  await withBrowser(server, async (browser) => {
    const page = await browser.newPage({ viewport: layout.viewport });

    const iframe = page.locator(".frame iframe");
    const panel = page.frameLocator(".frame iframe");
    await page.goto(`${server.origin}${path}`);
    await applyPanelLayout(page, layout);

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
          x: box.x + (rect.x + rect.width / 2) * layout.scale,
          y: box.y + (rect.y + rect.height / 2) * layout.scale,
        };
      },
      record: (out, actions, options = {}) =>
        recordPanel(page, iframe, out, actions, options),
    });
  });
}
