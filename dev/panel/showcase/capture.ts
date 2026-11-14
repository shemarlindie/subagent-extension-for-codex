// Captures every showcase step in both themes as PNGs, or one playback loop per
// theme as WebM with --video or as lossless PNG frames with --frames:
// npm run showcase:capture [-- --out dir --scale 2 --video --fps 60 --frames]
// Reuses a running panel-dev server, or starts one for the capture.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { type Browser, chromium, type Page } from "@playwright/test";
import { createServer } from "vite";

import { describeFrameCheck, startFrameCheck } from "./frame-check";
import { PLAYBACK_MS } from "./playback";
import { story, storyAt } from "./story";

const ORIGIN = "http://127.0.0.1:5317";
const VIEWPORT = { width: 1600, height: 1000 };
const THEMES = ["dark", "light"] as const;

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "showcase-captures" },
    scale: { type: "string", default: "2" },
    video: { type: "boolean", default: false },
    frames: { type: "boolean", default: false },
    fps: { type: "string", default: "60" },
    zoom: { type: "string", default: "1.4" },
  },
});

function positive(name: "scale" | "fps" | "zoom", integer = false) {
  const value = Number(values[name]);

  if (
    !(value > 0 && Number.isFinite(value)) ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `--${name} must be a positive ${integer ? "integer" : "number"}`,
    );
  }

  return value;
}

const scale = positive("scale");
const fps = positive("fps", true);
const pageZoom = positive("zoom");

// Chromium's screencast frames use CSS viewport pixels, whatever the device
// scale. Every capture opens a viewport at the export size and zooms the page
// back to the showcase layout, so stills match video frames.
const size = {
  width: Math.round(VIEWPORT.width * scale),
  height: Math.round(VIEWPORT.height * scale),
};

async function openShowcase(page: Page, query: string) {
  await page.goto(`${ORIGIN}/showcase.html?${query}`);

  await page.evaluate((zoom) => {
    document.documentElement.style.zoom = String(zoom);
  }, scale * pageZoom);
}

const reachable = await fetch(`${ORIGIN}/showcase.html`).then(
  (response) => response.ok,
  () => false,
);

const server = reachable
  ? undefined
  : await createServer({ configFile: resolve("vite.config.ts") }).then(
      (created) => created.listen(),
    );

const out = resolve(values.out);

async function captureSteps(browser: Browser) {
  const page = await browser.newPage({ viewport: size });

  for (const theme of THEMES) {
    for (const [step, { label, panel }] of story.entries()) {
      await openShowcase(page, `step=${step}&theme=${theme}&capture`);

      // The panel opens once Codex delegates.
      if (storyAt({ step })) {
        await page
          .frameLocator("iframe")
          .getByText("Parent agent")
          .first()
          .waitFor();
      }

      // Lets the panel finish layout and its entrance transitions.
      await page.waitForTimeout(panel ? 1200 : 400);

      const name = `${step + 1}-${label.toLowerCase().replace(/\W+/g, "-")}-${theme}.png`;
      await page.screenshot({ path: join(out, name) });
      console.log(join(values.out, name));
    }
  }
}

// Starts playback on a prepared page so neither startup nor resizing is
// recorded.
async function startPlayback(browser: Browser, theme: string) {
  const page = await browser.newPage({ viewport: size });
  await openShowcase(page, `step=0&theme=${theme}`);
  await page.addStyleTag({ content: ".controls { display: none; }" });

  const started = await page
    .getByText("Play", { exact: true })
    .evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Play button not found");
      }

      button.click();

      return performance.now();
    });

  return { page, started };
}

async function remainingPlaybackMs(page: Page, started: number) {
  const elapsed = await page.evaluate(
    (start) => performance.now() - start,
    started,
  );

  return Math.max(0, PLAYBACK_MS - elapsed);
}

// Plays the story once unrecorded, since a fresh browser's first-run work
// drops frames in the first capture.
async function warmUp(browser: Browser) {
  const { page, started } = await startPlayback(browser, THEMES[0]);
  await page.waitForTimeout(await remainingPlaybackMs(page, started));
  await page.close();
}

async function captureVideo(browser: Browser) {
  for (const theme of THEMES) {
    const { page, started } = await startPlayback(browser, theme);
    const name = `showcase-${theme}.webm`;
    const shots: number[] = [];
    const check = await startFrameCheck(page);

    await page.screencast.start({
      path: join(out, name),
      size,
      fps,
      quality: 100,
      onFrame: ({ timestamp }) => {
        shots.push(timestamp);
      },
    });

    await page.waitForTimeout(await remainingPlaybackMs(page, started));
    await page.screencast.stop();
    const result = await check(shots);
    await page.close();

    console.log(`${join(values.out, name)} (${describeFrameCheck(result)})`);
  }
}

// Playwright's screencast only delivers JPEG frames, so this asks Chromium for
// PNG frames directly. Chromium sends a frame when the page changes, so the
// ffconcat list keeps each frame on screen until the next one.
async function captureFrames(browser: Browser) {
  for (const theme of THEMES) {
    const dir = join(out, `showcase-${theme}-frames`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir);

    const { page, started } = await startPlayback(browser, theme);
    const check = await startFrameCheck(page);
    const cdp = await page.context().newCDPSession(page);
    const frames: { file: string; time: number }[] = [];
    const pending: Promise<unknown>[] = [];
    let recording = true;

    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      // Ignores frames that arrive while stopping, so the list stays final.
      if (!recording) {
        return;
      }

      const file = `${String(frames.length).padStart(5, "0")}.png`;
      frames.push({ file, time: metadata.timestamp ?? Date.now() / 1000 });

      pending.push(
        writeFile(join(dir, file), data, "base64"),
        cdp.send("Page.screencastFrameAck", { sessionId }),
      );
    });

    await cdp.send("Page.startScreencast", {
      format: "png",
      maxWidth: size.width,
      maxHeight: size.height,
    });

    await page.waitForTimeout(await remainingPlaybackMs(page, started));
    recording = false;
    const end = Date.now() / 1000;
    await cdp.send("Page.stopScreencast");
    await Promise.all(pending);
    const result = await check(frames.map(({ time }) => time * 1000));
    await page.close();

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

    console.log(
      `${join(values.out, `showcase-${theme}-frames`)} (${describeFrameCheck(result)})`,
    );
  }
}

await mkdir(out, { recursive: true });

// Metal GPU rendering on macOS. Headless Chromium otherwise renders on the
// CPU, which drops frames at 2x.
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"],
});

try {
  if (values.frames) {
    await warmUp(browser);
    await captureFrames(browser);
  } else if (values.video) {
    await warmUp(browser);
    await captureVideo(browser);
  } else {
    await captureSteps(browser);
  }
} finally {
  await browser.close();
  await server?.close();
}
