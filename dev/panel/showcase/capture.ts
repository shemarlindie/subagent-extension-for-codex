// Captures every showcase step in both themes as PNGs:
// npm run showcase:capture [-- --out dir --scale 2]
// Reuses a running panel-dev server, or starts one for the capture.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

import { story, storyAt } from "./story";

const ORIGIN = "http://127.0.0.1:5317";
const VIEWPORT = { width: 1600, height: 1000 };

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "showcase-captures" },
    scale: { type: "string", default: "2" },
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
await mkdir(out, { recursive: true });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: Number(values.scale),
  });

  for (const theme of ["dark", "light"]) {
    for (const [step, { label, panel }] of story.entries()) {
      await page.goto(
        `${ORIGIN}/showcase.html?step=${step}&theme=${theme}&capture`,
      );

      // The panel opens once Codex delegates.
      if (storyAt(step)) {
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
} finally {
  await browser.close();
  await server?.close();
}
