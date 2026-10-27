// Captures every showcase step in both themes as PNGs, or with --video, one
// playback loop per theme as WebM:
// npm run showcase:capture [-- --out dir --scale 2 --video --fps 60]
// Reuses a running panel-dev server, or starts one for the capture.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { type Browser, chromium, type Page } from "@playwright/test";
import { createServer } from "vite";

import { PLAYBACK_MS } from "./playback";
import { story, storyAt } from "./story";

const ORIGIN = "http://127.0.0.1:5317";
const VIEWPORT = { width: 1600, height: 1000 };
const THEMES = ["dark", "light"];

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "showcase-captures" },
    scale: { type: "string", default: "2" },
    video: { type: "boolean", default: false },
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
// scale. Both captures open a viewport at the export size and zoom the page
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

async function captureVideo(browser: Browser) {
  for (const theme of THEMES) {
    const page = await browser.newPage({ viewport: size });
    await openShowcase(page, `step=0&theme=${theme}`);
    await page.addStyleTag({ content: ".controls { display: none; }" });

    // Start from the prepared page so neither startup nor resizing is recorded.
    const started = await page
      .getByText("Play", { exact: true })
      .evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Play button not found");
        }

        button.click();

        return performance.now();
      });

    const name = `showcase-${theme}.webm`;
    let frames = 0;
    const frameBuckets = new Map<number, number>();

    await page.screencast.start({
      path: join(out, name),
      size,
      fps,
      quality: 100,
      onFrame: ({ timestamp }) => {
        frames++;
        const second = Math.floor(timestamp / 1000);
        frameBuckets.set(second, (frameBuckets.get(second) ?? 0) + 1);
      },
    });

    const elapsed = await page.evaluate(
      (start) => performance.now() - start,
      started,
    );

    await page.waitForTimeout(Math.max(0, PLAYBACK_MS - elapsed));
    await page.screencast.stop();
    await page.close();

    console.log(
      `${join(values.out, name)} (${frames} captured frames, peak ${Math.max(...frameBuckets.values())} frames/s)`,
    );
  }
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

try {
  await (values.video ? captureVideo(browser) : captureSteps(browser));
} finally {
  await browser.close();
  await server?.close();
}
