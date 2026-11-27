// The labeled header above each comparison side's panel, with its readouts.
import type { Page } from "@playwright/test";

import { CLOCK_START } from "./comparison-sources";

const LAYOUT = `
  .toolbar, .inspector { display: none !important; }
  html, body, #root, .host {
    margin: 0 !important; width: 100% !important; height: 100% !important;
    overflow: hidden !important;
  }
  .host { display: block !important; padding: 0 !important; }
  .stage {
    position: fixed !important; inset: var(--comparison-header) 0 0 !important;
    padding: 0 !important; display: block !important; overflow: hidden !important;
  }
  .stage .frame {
    width: 100% !important; height: 100% !important; max-width: none !important;
    border: 0 !important; border-radius: 0 !important;
  }
  .stage .frame iframe { width: 100% !important; height: 100% !important; display: block !important; }
`;

type Reading = number | string;

export type Readout = {
  label: string;
  /** Shown after numbers when there's no `format`. */
  unit?: string;
  /**
   * Reads the running panel every animation frame. It runs in the dev host
   * page, so it can't use anything from the script's scope.
   */
  value: (panel: Window) => Reading;
  /** Shows a number. It runs in the page too. */
  format?: (value: number) => string;
};

type Title = { label: string; note?: string };

type HeaderSettings = Title & {
  color: string;
  caption?: string;
  /** Every side's title, so all headers share the tallest one's height. */
  titles: Title[];
  startMs: number;
  speed: number;
  playMs: number;
};

/** Readout values at a fixture time, keyed by readout label. */
export type Sample = { ms: number; values: Record<string, Reading> };

// Runs in the dev host page. Samples the readouts while the clock plays.
function installHeader(
  settings: HeaderSettings & { clockStart: string },
  readouts: Readout[],
) {
  const element = (tag: string, style: string, text = "") => {
    const node = document.createElement(tag);
    node.style.cssText = style;
    node.textContent = text;

    return node;
  };

  const header = element(
    "div",
    "position: fixed; inset: 0 0 auto; display: flex; flex-direction: column; box-sizing: border-box; padding: 16px 20px; background: #f8fafc; border-bottom: 1px solid #dce2ea; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #17202f; z-index: 10000; overflow: hidden;",
  );

  const label = element(
    "div",
    `font-size: 26px; font-weight: 750; letter-spacing: -0.5px; color: ${settings.color};`,
  );

  const note = element(
    "div",
    "font-size: 14px; margin-top: 4px; color: #58677a;",
  );

  // The caption and readouts sit at the bottom, level on every side.
  const footer = element("div", "margin-top: auto;");
  header.append(label, note, footer);

  if (settings.caption) {
    footer.append(
      element(
        "div",
        "font-size: 14px; margin-top: 9px; color: #58677a;",
        settings.caption,
      ),
    );
  }

  // Readouts sit in fixed grid cells, so changing values never move the layout.
  const values = readouts.map((readout) => {
    const block = element(
      "div",
      "min-width: 0; font-size: 12px; color: #58677a; font-variant-numeric: tabular-nums; white-space: nowrap;",
      readout.label.toUpperCase(),
    );

    const value = element(
      "strong",
      "display: block; height: 1.3em; line-height: 1.3; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; font-size: 19px; color: #17202f;",
    );

    block.append(value);

    return { readout, block, value };
  });

  if (values.length > 0) {
    const grid = element(
      "div",
      "display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px 16px; margin-top: 12px;",
    );

    grid.append(...values.map(({ block }) => block));
    footer.append(grid);
  }

  document.body.append(header);

  // Every side gets the tallest header, so the panels line up in the video.
  const show = ({ label: text, note: detail }: Title) => {
    label.textContent = text;
    note.textContent = detail ?? "";
    note.style.display = detail ? "" : "none";

    return header.offsetHeight;
  };

  const height = Math.max(...settings.titles.map(show));
  show(settings);
  header.style.height = `${height}px`;

  document.documentElement.style.setProperty(
    "--comparison-header",
    `${height}px`,
  );

  const display = (readout: Readout, result: Reading) => {
    if (typeof result === "string") return result;
    if (readout.format) return readout.format(result);
    const unit = readout.unit ? ` ${readout.unit}` : "";

    return `${Math.round(result).toLocaleString()}${unit}`;
  };

  const samples: Sample[] = [];
  Object.assign(window, { __comparisonSamples: samples });
  const iframe = document.querySelector<HTMLIFrameElement>(".frame iframe");

  const update = () => {
    requestAnimationFrame(update);
    const panel = iframe?.contentWindow;
    if (!panel || values.length === 0) return;

    const reading: Record<string, Reading> = {};

    for (const { readout, value } of values) {
      try {
        const result = readout.value(panel);
        reading[readout.label] = result;
        value.textContent = display(readout, result);
      } catch {}
    }

    const start = (globalThis as Record<string, unknown>)[settings.clockStart];
    if (typeof start !== "number") return;

    const played = (performance.now() - start) * settings.speed;
    if (played > settings.playMs) return;

    samples.push({
      ms: Math.round(settings.startMs + played),
      values: reading,
    });
  };

  update();
}

const source = (fn: ((...args: never[]) => unknown) | undefined) =>
  fn ? fn.toString() : "undefined";

/** Moves the panel below a header with `settings` and live `readouts`. */
export async function addHeader(
  page: Page,
  settings: HeaderSettings,
  readouts: Readout[],
) {
  await page.addStyleTag({ content: LAYOUT });

  const list = readouts.map(
    (readout) =>
      `{ label: ${JSON.stringify(readout.label)}, unit: ${JSON.stringify(readout.unit)}, value: ${source(readout.value)}, format: ${source(readout.format)} }`,
  );

  const args = JSON.stringify({ ...settings, clockStart: CLOCK_START });

  // tsx names functions with a `__name` helper, which the page lacks.
  await page.evaluate(
    `((__name) => (${installHeader.toString()})(${args}, [${list.join(", ")}]))((f) => f)`,
  );
}

export const headerSamples = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __comparisonSamples: Sample[] })
        .__comparisonSamples,
  );
