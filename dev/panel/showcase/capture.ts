// Captures every showcase step in both themes as PNGs, or with --video, one
// playback loop per theme as WebM:
// npm run showcase:capture [-- --out dir --scale 2 --video]
// Reuses a running panel-dev server, or starts one for the capture.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { type Browser, chromium } from "@playwright/test";
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
  },
});

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
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: Number(values.scale),
  });

  for (const theme of THEMES) {
    for (const [step, { label, panel }] of story.entries()) {
      await page.goto(
        `${ORIGIN}/showcase.html?step=${step}&theme=${theme}&capture`,
      );

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

// Playwright records at the viewport's size, whatever the scale.
async function captureVideo(browser: Browser) {
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: out, size: VIEWPORT },
    });

    const page = await context.newPage();
    await page.goto(`${ORIGIN}/showcase.html?play&theme=${theme}&capture`);
    await page.waitForTimeout(PLAYBACK_MS);
    await context.close();

    const name = `showcase-${theme}.webm`;
    await page.video()!.saveAs(join(out, name));
    await page.video()!.delete();
    console.log(join(values.out, name));
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
