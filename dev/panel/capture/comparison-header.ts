// The labeled header above each comparison side's panel, with its readout.
import type { Page } from "@playwright/test";

const HEIGHT = 110;

const LAYOUT = `
  .toolbar, .inspector { display: none !important; }
  html, body, #root, .host {
    margin: 0 !important; width: 100% !important; height: 100% !important;
    overflow: hidden !important;
  }
  .host { display: block !important; padding: 0 !important; }
  .stage {
    position: fixed !important; inset: ${HEIGHT}px 0 0 !important;
    padding: 0 !important; display: block !important; overflow: hidden !important;
  }
  .stage .frame {
    width: 100% !important; height: 100% !important; max-width: none !important;
    border: 0 !important; border-radius: 0 !important;
  }
  .stage .frame iframe { width: 100% !important; height: 100% !important; display: block !important; }
`;

export type HeaderSettings = {
  label: string;
  color: string;
  caption?: string;
  readout?: { label: string; unit?: string };
  /** The global that holds the fixture clock's start. */
  clockStart: string;
  startMs: number;
  speed: number;
  playMs: number;
};

/** A readout value at a fixture time. */
export type Sample = { ms: number; value: number };

// Runs in the dev host page. Samples the readout while the clock plays.
function installHeader(
  settings: HeaderSettings & { height: number },
  read?: (panel: Window) => number,
) {
  const element = (tag: string, style: string, text = "") => {
    const node = document.createElement(tag);
    node.style.cssText = style;
    node.textContent = text;

    return node;
  };

  const header = element(
    "div",
    `position: fixed; inset: 0 0 auto; height: ${settings.height}px; box-sizing: border-box; padding: 16px 20px; background: #f8fafc; border-bottom: 1px solid #dce2ea; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #17202f; z-index: 10000;`,
  );

  const top = element(
    "div",
    "display: flex; align-items: center; justify-content: space-between; gap: 12px;",
  );

  const value = element(
    "strong",
    "display: block; margin-top: 3px; font-size: 19px; color: #17202f;",
  );

  top.append(
    element(
      "div",
      `font-size: 26px; font-weight: 750; letter-spacing: -0.5px; color: ${settings.color};`,
      settings.label,
    ),
  );

  if (settings.readout) {
    const readout = element(
      "div",
      "font-size: 12px; color: #58677a; text-align: right; font-variant-numeric: tabular-nums;",
      settings.readout.label.toUpperCase(),
    );

    readout.append(value);
    top.append(readout);
  }

  header.append(top);

  if (settings.caption) {
    header.append(
      element(
        "div",
        "font-size: 14px; margin-top: 9px; color: #58677a;",
        settings.caption,
      ),
    );
  }

  document.body.append(header);

  const samples: Sample[] = [];
  Object.assign(window, { __comparisonSamples: samples });
  const iframe = document.querySelector<HTMLIFrameElement>(".frame iframe");
  const unit = settings.readout?.unit ? ` ${settings.readout.unit}` : "";

  const update = () => {
    requestAnimationFrame(update);
    const panel = iframe?.contentWindow;
    if (!read || !panel) return;

    let reading: number;

    try {
      reading = read(panel);
    } catch {
      return;
    }

    value.textContent = `${Math.round(reading).toLocaleString()}${unit}`;
    const start = (globalThis as Record<string, unknown>)[settings.clockStart];
    if (typeof start !== "number") return;

    const played = (performance.now() - start) * settings.speed;
    if (played > settings.playMs) return;

    samples.push({ ms: Math.round(settings.startMs + played), value: reading });
  };

  update();
}

/** Moves the panel below a header with `settings` and the live readout. */
export async function addHeader(
  page: Page,
  settings: HeaderSettings,
  read?: (panel: Window) => number,
) {
  await page.addStyleTag({ content: LAYOUT });

  const install = installHeader.toString();
  const args = JSON.stringify({ ...settings, height: HEIGHT });
  const reader = read ? read.toString() : "undefined";

  // tsx names functions with a `__name` helper, which the page lacks.
  await page.evaluate(
    `((__name) => (${install})(${args}, ${reader}))((f) => f)`,
  );
}

export const headerSamples = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __comparisonSamples: Sample[] })
        .__comparisonSamples,
  );
