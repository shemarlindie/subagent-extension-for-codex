import type { Page } from "@playwright/test";

type Size = { width: number; height: number };

export type PanelSetup = {
  /** Dev host viewport in CSS pixels. The default is 800 × 640. */
  viewport?: Size;
  /** Exact dimensions of the panel iframe in CSS pixels. */
  panelSize?: Partial<Size>;
  /** Capture pixels per CSS pixel. The default is 2. */
  scale?: number;
};

function positivePixels(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }

  return value;
}

export function panelLayout({ viewport, panelSize, scale = 2 }: PanelSetup) {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Capture scale must be a positive number");
  }

  if (panelSize?.width !== undefined) {
    positivePixels(panelSize.width, "Panel width");
  }

  if (panelSize?.height !== undefined) {
    positivePixels(panelSize.height, "Panel height");
  }

  const width = positivePixels(viewport?.width ?? 800, "Viewport width");
  const height = positivePixels(viewport?.height ?? 640, "Viewport height");

  return {
    scale,
    panelSize,
    fitViewport: viewport === undefined,
    viewport: {
      width: positivePixels(Math.ceil(width * scale), "Capture viewport width"),
      height: positivePixels(
        Math.ceil(height * scale),
        "Capture viewport height",
      ),
    },
  };
}

export async function applyPanelLayout(
  page: Page,
  { scale, panelSize, fitViewport, viewport }: ReturnType<typeof panelLayout>,
) {
  const { width, height } = panelSize ?? {};

  const widthRules =
    width === undefined
      ? ""
      : `
    .stage { justify-content: safe center; }
    .stage .frame { width: max-content; max-width: none; flex-shrink: 0; }
    .stage .frame iframe { width: ${width}px; }
  `;

  const heightRules =
    height === undefined
      ? ""
      : `
    .stage .frame { height: max-content; }
    .stage .frame iframe { height: ${height}px; }
  `;

  // Chromium screencasts capture CSS pixels, regardless of device scale.
  // Keep the host inside the viewport while zooming its CSS layout.
  await page.addStyleTag({
    content: `
      :root { zoom: ${scale}; }
      .host { height: calc(100dvh / ${scale}); }
      ${widthRules}
      ${heightRules}
    `,
  });

  if (!fitViewport || (width === undefined && height === undefined)) return;

  const overflow = await page.locator(".stage").evaluate((stage) => ({
    width: stage.scrollWidth - stage.clientWidth,
    height: stage.scrollHeight - stage.clientHeight,
  }));

  await page.setViewportSize({
    width:
      viewport.width +
      (width === undefined ? 0 : Math.ceil(overflow.width * scale)),
    height:
      viewport.height +
      (height === undefined ? 0 : Math.ceil(overflow.height * scale)),
  });
}
