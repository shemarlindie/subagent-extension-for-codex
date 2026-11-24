import { imageMime, isBinary } from "../changes/changes.js";
import { AttachmentError } from "./attachment-error.js";

/** Detect the raster container from the bytes. An image suffix must agree. */
export function uploadMime(bytes: Uint8Array, name: string) {
  const tag = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  const end = bytes.length;
  let mime: string | undefined;

  if (
    tag(0, 8) === "\x89PNG\r\n\x1a\n" &&
    tag(12, 4) === "IHDR" &&
    tag(end - 8, 4) === "IEND"
  ) {
    mime = "image/png";
  } else if (tag(0, 3) === "\xff\xd8\xff" && tag(end - 2, 2) === "\xff\xd9") {
    mime = "image/jpeg";
  } else if (
    ["GIF87a", "GIF89a"].includes(tag(0, 6)) &&
    end > 13 &&
    bytes[end - 1] === 0x3b
  ) {
    mime = "image/gif";
  } else if (
    tag(0, 4) === "RIFF" &&
    tag(8, 4) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(tag(12, 4)) &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) === end - 8
  ) {
    mime = "image/webp";
  }

  const expected = imageMime(name);

  if (expected && expected !== mime) {
    throw new AttachmentError("Invalid or unsupported image.");
  }

  if (!mime && isBinary(bytes)) {
    throw new AttachmentError("Unsupported binary file.");
  }

  return mime;
}
