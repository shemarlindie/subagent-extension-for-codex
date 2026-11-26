import { imageMime, isBinary } from "../changes/changes.js";
import { AttachmentError } from "./attachment-error.js";

/**
 * Whether a JPEG has its end-of-image marker. Some cameras append data after
 * it, such as a motion photo's video.
 */
function hasJpegEnd(bytes: Uint8Array) {
  for (let i = bytes.length - 2; i > 2; i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
  }

  return false;
}

const ZIP = "PK\x03\x04";
const OLE = "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1";
const OPEN_XML = "application/vnd.openxmlformats-officedocument";
const OPEN_DOCUMENT = "application/vnd.oasis.opendocument";

/**
 * Documents the worker opens with its own tools, by suffix, with the
 * signature their bytes start with.
 */
const DOCUMENTS: Partial<Record<string, { mime: string; signature: string }>> =
  {
    pdf: { mime: "application/pdf", signature: "%PDF-" },
    docx: { mime: `${OPEN_XML}.wordprocessingml.document`, signature: ZIP },
    xlsx: { mime: `${OPEN_XML}.spreadsheetml.sheet`, signature: ZIP },
    pptx: { mime: `${OPEN_XML}.presentationml.presentation`, signature: ZIP },
    odt: { mime: `${OPEN_DOCUMENT}.text`, signature: ZIP },
    ods: { mime: `${OPEN_DOCUMENT}.spreadsheet`, signature: ZIP },
    odp: { mime: `${OPEN_DOCUMENT}.presentation`, signature: ZIP },
    doc: { mime: "application/msword", signature: OLE },
    xls: { mime: "application/vnd.ms-excel", signature: OLE },
    ppt: { mime: "application/vnd.ms-powerpoint", signature: OLE },
  };

const suffix = (name: string) =>
  /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";

/** The stored file's extension for an upload's detected type. */
export function uploadExtension(mime: string) {
  const document = Object.entries(DOCUMENTS).find(
    ([, entry]) => entry?.mime === mime,
  );

  return `.${document?.[0] ?? mime.slice("image/".length)}`;
}

/**
 * Detect an image's raster container, or a document by its suffix and
 * signature. An image or document suffix must agree with the bytes. Other
 * files must be text.
 */
export function uploadMime(bytes: Uint8Array, name: string) {
  const tag = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  const document = DOCUMENTS[suffix(name)];

  if (document) {
    if (tag(0, document.signature.length) !== document.signature) {
      throw new AttachmentError("Invalid or unsupported document.");
    }

    return document.mime;
  }

  const end = bytes.length;
  let mime: string | undefined;

  if (
    tag(0, 8) === "\x89PNG\r\n\x1a\n" &&
    tag(12, 4) === "IHDR" &&
    tag(end - 8, 4) === "IEND"
  ) {
    mime = "image/png";
  } else if (tag(0, 3) === "\xff\xd8\xff" && hasJpegEnd(bytes)) {
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
