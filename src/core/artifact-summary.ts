import type { Sharp } from "sharp";

import {
  artifactFileName,
  artifactFormat,
  type ArtifactSummary,
  baseMime,
  isBase64Image,
  summarizeArtifact,
} from "./artifact-file.js";
import type { Artifact } from "./model.js";

/** Raise when the summary shape or contents change; stored summaries are rebuilt. */
export const SUMMARY_VERSION = 2;

/** Card thumbnails are at most this many pixels on each side (twice the card's size). */
const THUMBNAIL_SIZE = 320;

/** Larger sources are not decoded for a thumbnail. */
const MAX_THUMBNAIL_SOURCE_BYTES = 40 * 1024 * 1024;

/** Decoding stops past this many pixels, so a small file cannot expand into a huge image. */
const MAX_THUMBNAIL_SOURCE_PIXELS = 100_000_000;

/** What sharp's prebuilt libvips decodes. HEIC (HEVC) and BMP are not included. */
const DECODABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/tiff",
  "image/svg+xml",
]);

type SharpFactory = (input: Buffer, options: Record<string, unknown>) => Sharp;

let loading: Promise<SharpFactory | undefined> | undefined;

/**
 * Loads sharp on first use. It needs a native binary for this platform; when
 * that is missing, images list without thumbnails instead of the service
 * failing to start.
 */
export function loadSharp(): Promise<SharpFactory | undefined> {
  loading ??= import("sharp").then(
    (module) => module.default as unknown as SharpFactory,
    (error: unknown) => {
      console.warn(
        `Image thumbnails are off: sharp could not load (${error instanceof Error ? error.message : String(error)}).`,
      );

      return undefined;
    },
  );

  return loading;
}

/**
 * Whether a thumbnail has no transparent pixels, ignoring its 1-pixel border:
 * an SVG is rendered straight at thumbnail scale, and the resampled edges come
 * out part-covered even when the drawing is opaque (verified across sizes; the
 * interior stays fully opaque).
 */
async function isOpaque(sharp: SharpFactory, thumbnail: Buffer) {
  const { width = 0, height = 0 } = await sharp(thumbnail, {}).metadata();

  const interior =
    width > 2 && height > 2
      ? sharp(thumbnail, {}).extract({
          left: 1,
          top: 1,
          width: width - 2,
          height: height - 2,
        })
      : sharp(thumbnail, {});

  // stats() would measure the input and ignore extract(), so scan the
  // extracted pixels' alpha directly.
  const { data, info } = await interior
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 4) return true;

  for (let index = 3; index < data.length; index += info.channels)
    if (data[index] < 255) return false;

  return true;
}

/**
 * A JPEG thumbnail as a data URL, or PNG when the image has transparency.
 * libvips decodes off the main thread, so a large image does not stall other
 * requests. Animated images use their first frame.
 */
export async function thumbnail(
  source: Buffer,
  mime: string,
  load: () => Promise<SharpFactory | undefined> = loadSharp,
) {
  if (!DECODABLE.has(mime) || source.length > MAX_THUMBNAIL_SOURCE_BYTES)
    return undefined;

  const sharp = await load();
  if (!sharp) return undefined;

  try {
    const image = sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_THUMBNAIL_SOURCE_PIXELS,
      animated: false,
    });

    const { hasAlpha } = await image.metadata();

    const resized = await image
      .autoOrient()
      .resize({
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .timeout({ seconds: 10 })
      .png()
      .toBuffer();

    // Many opaque images (screenshots) still carry an alpha channel; only real
    // transparency keeps PNG. Checked on the small thumbnail, so it is cheap.
    const transparent = hasAlpha && !(await isOpaque(sharp, resized));

    const output = transparent
      ? resized
      : // Dropping alpha keeps the true colors of part-covered edge pixels;
        // JPEG's own flattening would blend them into a dark outline.
        await sharp(resized, {})
          .removeAlpha()
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();

    return `data:image/${transparent ? "png" : "jpeg"};base64,${output.toString("base64")}`;
  } catch {
    // A corrupt or unsupported image lists without a thumbnail.
    return undefined;
  }
}

/**
 * A placeholder for an artifact whose summary could not be built, keeping
 * whatever metadata its stored body still yields.
 */
export function unreadableSummary(
  id: string,
  taskId: string,
  body: unknown,
  error: unknown,
): ArtifactSummary {
  let stored: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(String(body));
    if (parsed && typeof parsed === "object") stored = parsed;
  } catch {}

  const text = (key: string, fallback: string) =>
    typeof stored[key] === "string" ? (stored[key] as string) : fallback;

  const info = {
    type: text("type", "unknown"),
    title: text("title", id),
    mime_type: text("mime_type", "application/octet-stream"),
  };

  return {
    id,
    task_id: taskId,
    ...info,
    created_at: text("created_at", ""),
    file_name: artifactFileName(info),
    format: artifactFormat(info),
    size: typeof stored.content === "string" ? stored.content.length : 0,
    snippet: {
      kind: "error",
      message: `This artifact could not be read: ${error instanceof Error ? error.message : String(error)}`,
    },
  };
}

/** The shared summary, plus a thumbnail for raster images. */
export async function summarizeStoredArtifact(
  artifact: Artifact,
): Promise<ArtifactSummary> {
  const summary = summarizeArtifact(artifact);
  const mime = baseMime(artifact);

  // Raster images, and SVGs too large to show as themselves, get a raster
  // thumbnail. Small SVGs keep the shared summarizer's vector snippet.
  const source = isBase64Image(artifact)
    ? Buffer.from(artifact.content.trim(), "base64")
    : mime === "image/svg+xml" && summary.snippet.kind === "none"
      ? Buffer.from(artifact.content, "utf8")
      : undefined;

  if (source) {
    const src = await thumbnail(source, mime);
    if (src) summary.snippet = { kind: "image", src };
  }

  return summary;
}
