// Lossless PNG screencast frames with their timing.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { withCleanup } from "./capture-cleanup";
import { checkCaptureFrames, describeFrameCheck } from "./frame-check";

type CapturedFrame = { file: string; time: number };

export function frameTimeline(frames: CapturedFrame[], end: number) {
  const last = frames.at(-1);
  if (!last) throw new Error("Cannot write a timeline without captured frames");

  const list = frames.map(({ file, time }, index) => {
    // Keep capture order when Chromium timestamps or the stop clock drift.
    const duration = Math.max(0, (frames[index + 1]?.time ?? end) - time);

    // The default 1/25 s time base rounds away motion above 25 fps.
    return `file ${file}\noption framerate 1000\nduration ${duration.toFixed(4)}`;
  });

  // The concat demuxer ignores the last duration unless the file repeats.
  list.push(`file ${last.file}\noption framerate 1000`);

  return `ffconcat version 1.0\n${list.join("\n")}\n`;
}

// Playwright's screencast only delivers JPEG frames, so this asks Chromium for
// PNG frames directly. Chromium sends a frame when the page changes, so the
// ffconcat list keeps each frame on screen until the next one. Records until
// `recording` settles, and returns the frame check summary.
export async function capturePngFrames(
  page: Page,
  dir: string,
  recording: () => Promise<unknown>,
  size?: { width: number; height: number },
) {
  await mkdir(dir, { recursive: true });

  const frames: CapturedFrame[] = [];
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
          maxWidth: size?.width,
          maxHeight: size?.height,
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

  await writeFile(join(dir, "frames.ffconcat"), frameTimeline(frames, end));

  return describeFrameCheck(result);
}
