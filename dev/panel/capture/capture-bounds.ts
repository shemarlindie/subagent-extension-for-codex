import type { Locator } from "@playwright/test";

import type { CaptureRect } from "./panel-mp4";

type Bounds = { left: number; top: number; right: number; bottom: number };

export function rectangleBounds({ x, y, width, height }: CaptureRect): Bounds {
  if (
    ![x, y, width, height, x + width, y + height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      "Capture rectangle must have finite coordinates and a positive size",
    );
  }

  return { left: x, top: y, right: x + width, bottom: y + height };
}

// The MP4 has one size. Sample each frame to keep all positions of a target,
// including when the dev host's inspector shifts the iframe.
export function watchBounds(locator: Locator, followIframe: boolean) {
  return locator.evaluateHandle((element, followIframe) => {
    const container = followIframe ? element.parentElement : null;
    const frame = window.frameElement;

    if (window !== window.top && (!frame || window.parent !== window.top)) {
      throw new Error(
        "Use a locator in the dev host or panel iframe, or pass a capture rectangle",
      );
    }

    const stage = (frame ?? element).closest(".stage");
    let frameId: number;

    const watcher = {
      bounds: null as Bounds | null,
      intersect(rect: Bounds, clip: Bounds): Bounds {
        return {
          left: Math.max(rect.left, clip.left),
          top: Math.max(rect.top, clip.top),
          right: Math.min(rect.right, clip.right),
          bottom: Math.min(rect.bottom, clip.bottom),
        };
      },
      sample(this: void) {
        frameId = requestAnimationFrame(watcher.sample);

        const target = container ? container.querySelector("iframe") : element;
        const rect = target?.getBoundingClientRect();
        if (!rect?.width || !rect.height) return;

        let visible: Bounds = rect;

        // Chromium reports local CSS coordinates inside the zoomed iframe.
        // Map to capture pixels before intersecting the iframe and stage.
        if (frame) {
          if (!window.innerWidth) return;

          const outer = frame.getBoundingClientRect();
          const scale = outer.width / window.innerWidth;

          visible = watcher.intersect(
            {
              left: outer.left + rect.left * scale,
              top: outer.top + rect.top * scale,
              right: outer.left + rect.right * scale,
              bottom: outer.top + rect.bottom * scale,
            },
            outer,
          );
        }

        if (stage) {
          visible = watcher.intersect(visible, stage.getBoundingClientRect());
        }

        const { left, top, right, bottom } = visible;
        if (right <= left || bottom <= top) return;

        const bounds = watcher.bounds;

        watcher.bounds = bounds
          ? {
              left: Math.min(bounds.left, left),
              top: Math.min(bounds.top, top),
              right: Math.max(bounds.right, right),
              bottom: Math.max(bounds.bottom, bottom),
            }
          : { left, top, right, bottom };
      },
      stop() {
        cancelAnimationFrame(frameId);
      },
    };

    watcher.sample();

    return watcher;
  }, followIframe);
}

export function cropWithinViewport(
  bounds: Bounds | null,
  viewport: Pick<CaptureRect, "width" | "height">,
): CaptureRect {
  if (!bounds) throw new Error("The capture target was never visible");

  // H.264 in 4:2:0 needs even sizes.
  const even = (value: number) => Math.floor(value / 2) * 2;
  const x = even(Math.max(0, bounds.left));
  const y = even(Math.max(0, bounds.top));
  const width = even(Math.min(viewport.width, bounds.right)) - x;
  const height = even(Math.min(viewport.height, bounds.bottom)) - y;

  if (width < 2 || height < 2) {
    throw new Error(
      "The capture target needs at least two pixels in each dimension inside the viewport",
    );
  }

  return { x, y, width, height };
}
