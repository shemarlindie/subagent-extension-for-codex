// Shared parts of the panel capture scripts: the dev server, a GPU browser and
// lossless PNG screencast frames with their timing.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium, type Page } from "@playwright/test";
import { createServer } from "vite";

import { withCleanup } from "./capture-cleanup";
import { checkCaptureFrames, describeFrameCheck } from "./frame-check";

export const ORIGIN = "http://127.0.0.1:5317";

/** Reuses a running panel-dev server, or starts one. Close what it returns. */
export async function devServer(path: string) {
  const reachable = await fetch(`${ORIGIN}${path}`).then(
    (response) => response.ok,
    () => false,
  );

  return reachable
    ? undefined
    : createServer({ configFile: resolve("vite.config.ts") }).then((created) =>
        created.listen(),
      );
}

// Metal GPU rendering on macOS. Headless Chromium otherwise renders on the
// CPU, which drops frames at 2x.
export function launchBrowser() {
  return chromium.launch({
    args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"],
  });
}

// Playwright's screencast only delivers JPEG frames, so this asks Chromium for
// PNG frames directly. Chromium sends a frame when the page changes, so the
// ffconcat list keeps each frame on screen until the next one. Records until
// `recording` settles, and returns the frame check summary.
export async function capturePngFrames(
  page: Page,
  dir: string,
  size: { width: number; height: number },
  recording: () => Promise<unknown>,
) {
  await mkdir(dir, { recursive: true });

  const frames: { file: string; time: number }[] = [];
  let end = 0;

  const result = await checkCaptureFrames(page, async () => {
    const cdp = await page.context().newCDPSession(page);
    const pending: Promise<unknown>[] = [];
    let active = true;
    let frameError: unknown;

    const rememberError = (error: unknown) => {
      frameError ??= error;
    };

    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      // Ignores frames that arrive while stopping, so the list stays final.
      if (!active) {
        return;
      }

      const file = `${String(frames.length).padStart(5, "0")}.png`;
      frames.push({ file, time: metadata.timestamp ?? Date.now() / 1000 });

      pending.push(
        writeFile(join(dir, file), data, "base64").catch(rememberError),
        cdp.send("Page.screencastFrameAck", { sessionId }).catch(rememberError),
      );
    });

    await withCleanup(
      async () => {
        await cdp.send("Page.startScreencast", {
          format: "png",
          maxWidth: size.width,
          maxHeight: size.height,
        });

        await withCleanup(recording, async () => {
          active = false;
          end = Date.now() / 1000;
          await cdp.send("Page.stopScreencast");
        });
      },
      async () => {
        active = false;
        await Promise.all(pending);
        await cdp.detach();
      },
    );

    if (frameError !== undefined) throw frameError;

    return frames.map(({ time }) => time * 1000);
  });

  // Each image otherwise gets a 1/25 s time base, which rounds frame times
  // and caps motion at 25 fps. The option gives millisecond timing.
  const list = frames.map(
    ({ file, time }, index) =>
      `file ${file}\noption framerate 1000\nduration ${((frames[index + 1]?.time ?? end) - time).toFixed(4)}`,
  );

  // The concat demuxer ignores the last duration unless the file repeats.
  list.push(`file ${frames.at(-1)?.file}\noption framerate 1000`);

  await writeFile(
    join(dir, "frames.ffconcat"),
    `ffconcat version 1.0\n${list.join("\n")}\n`,
  );

  return describeFrameCheck(result);
}
