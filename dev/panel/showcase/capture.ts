// Captures every showcase step in both themes as PNGs, or one playback loop per
// theme as WebM with --video or as lossless PNG frames with --frames:
// npm run showcase:capture [-- --out dir --scale 2 --video --fps 60 --frames]
// Reuses a running panel-dev server, or starts one for the capture.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { Browser, Page } from "@playwright/test";

import { describeFrameCheck, startFrameCheck } from "../capture/frame-check";
import {
  capturePngFrames,
  devServer,
  launchBrowser,
  ORIGIN,
} from "../capture/screencast";
import { PLAYBACK_MS } from "./playback";
import { story, storyAt } from "./story";

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

const server = await devServer("/showcase.html");

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

async function captureFrames(browser: Browser) {
  for (const theme of THEMES) {
    const name = `showcase-${theme}-frames`;
    const { page, started } = await startPlayback(browser, theme);

    const result = await capturePngFrames(page, join(out, name), size, () =>
      remainingPlaybackMs(page, started).then((ms) => page.waitForTimeout(ms)),
    );

    await page.close();
    console.log(`${join(values.out, name)} (${result})`);
  }
}

await mkdir(out, { recursive: true });

const browser = await launchBrowser();

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
