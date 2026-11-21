// Encodes captured PNG frames as the showcase MP4, optionally fitted to an
// exact output canvas.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

export type CaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OutputCanvas = {
  width: number;
  height: number;
  /** Defaults to `contain`, which centers the crop on black padding. */
  fit?: "contain" | "cover" | "stretch";
};

const FITS = new Set<unknown>(["contain", "cover", "stretch"]);

// H.264 in 4:2:0 needs even sizes.
const isEvenSize = (value: number) =>
  Number.isSafeInteger(value) && value > 0 && value % 2 === 0;

export function validateOutputCanvas(output: OutputCanvas) {
  if (!isEvenSize(output.width) || !isEvenSize(output.height)) {
    throw new Error(
      `Output size ${output.width}x${output.height} must use positive even integers`,
    );
  }

  if (output.fit !== undefined && !FITS.has(output.fit)) {
    throw new Error(`Unknown output fit: ${String(output.fit)}`);
  }
}

// Round to the nearest encodable size, including for subpixel fits.
const evenSize = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export function fitCanvas(
  crop: CaptureRect,
  { width, height, fit = "contain" }: OutputCanvas,
) {
  const canvas = { width, height };
  if (fit === "stretch") return { crop, scaled: canvas };

  const horizontal = width / crop.width;
  const vertical = height / crop.height;

  if (fit === "cover") {
    // Trim the source first so extreme aspect ratios never need a huge frame.
    const scale = Math.max(horizontal, vertical);

    const part = {
      width: evenSize(width / scale),
      height: evenSize(height / scale),
    };

    return {
      crop: {
        ...part,
        x: crop.x + (crop.width - part.width) / 2,
        y: crop.y + (crop.height - part.height) / 2,
      },
      scaled: canvas,
    };
  }

  const scale = Math.min(horizontal, vertical);

  return {
    crop,
    scaled: {
      width: evenSize(crop.width * scale),
      height: evenSize(crop.height * scale),
    },
  };
}

const cropFilter = ({ x, y, width, height }: CaptureRect) =>
  `crop=${width}:${height}:${x}:${y}:exact=1`;

function fitFilters(crop: CaptureRect, output: OutputCanvas) {
  const fitted = fitCanvas(crop, output);
  const { width, height } = fitted.scaled;

  const filters = [
    cropFilter(fitted.crop),
    `scale=${width}:${height}:flags=lanczos`,
  ];

  if (width !== output.width || height !== output.height) {
    filters.push(`pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2`);
  }

  // Square pixels keep players from stretching the canvas.
  return [...filters, "setsar=1"];
}

/**
 * Encodes `frames/frames.ffconcat` to `file` with the showcase settings,
 * cropped to `crop`, which must be even. With `output`, the MP4 has exactly
 * that size.
 */
export async function encodePanelMp4(
  frames: string,
  file: string,
  crop: CaptureRect,
  output?: OutputCanvas,
) {
  if (output) validateOutputCanvas(output);

  const filters = [
    ...(output ? fitFilters(crop, output) : [cropFilter(crop)]),
    "fps=60",
    "format=yuv420p",
  ];

  const out = resolve(file);
  await mkdir(dirname(out), { recursive: true });

  await promisify(execFile)("ffmpeg", [
    ...["-y", "-v", "error", "-safe", "0", "-f", "concat"],
    ...["-i", join(frames, "frames.ffconcat")],
    ...["-vf", filters.join(",")],
    ...["-c:v", "libx264", "-preset", "slow", "-tune", "animation"],
    ...["-crf", "12", "-movflags", "+faststart", "-an", out],
  ]);
}
