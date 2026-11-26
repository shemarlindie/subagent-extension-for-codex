import { isBinary } from "../changes/changes.js";

/** The type of bytes that are neither text nor a known image or document. */
export const OCTET_STREAM = "application/octet-stream";

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

/**
 * A document's type when its suffix names one and its bytes start with that
 * document's signature. The start of a file is enough.
 */
export function documentMime(bytes: Uint8Array, name: string) {
  const key = suffix(name);
  // An own key only, so a suffix such as `constructor` isn't a document.
  const document = Object.hasOwn(DOCUMENTS, key) ? DOCUMENTS[key] : undefined;
  if (!document) return undefined;

  const start = String.fromCharCode(
    ...bytes.subarray(0, document.signature.length),
  );

  return start === document.signature ? document.mime : undefined;
}

/** The stored file's extension for a detected image or document type. */
export function mimeExtension(mime: string) {
  const document = Object.entries(DOCUMENTS).find(
    ([, entry]) => entry?.mime === mime,
  );

  return `.${document?.[0] ?? mime.slice("image/".length)}`;
}

/** Whether bytes are UTF-8 text. */
function isText(bytes: Uint8Array) {
  if (isBinary(bytes)) return false;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);

    return true;
  } catch {
    return false;
  }
}

/**
 * A file's type by its bytes: an image's raster container, or a document
 * whose suffix matches its signature. Undefined for UTF-8 text, and
 * octet-stream for anything else, whatever the name says.
 */
export function fileMime(bytes: Uint8Array, name: string) {
  const tag = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  const document = documentMime(bytes, name);
  if (document) return document;
  const end = bytes.length;

  if (
    tag(0, 8) === "\x89PNG\r\n\x1a\n" &&
    tag(12, 4) === "IHDR" &&
    tag(end - 8, 4) === "IEND"
  ) {
    return "image/png";
  }

  if (tag(0, 3) === "\xff\xd8\xff" && hasJpegEnd(bytes)) return "image/jpeg";

  if (
    ["GIF87a", "GIF89a"].includes(tag(0, 6)) &&
    end > 13 &&
    bytes[end - 1] === 0x3b
  ) {
    return "image/gif";
  }

  if (
    tag(0, 4) === "RIFF" &&
    tag(8, 4) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(tag(12, 4)) &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) === end - 8
  ) {
    return "image/webp";
  }

  return isText(bytes) ? undefined : OCTET_STREAM;
}
