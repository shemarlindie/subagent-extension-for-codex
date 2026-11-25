import {
  ATTACHMENT_LIMITS,
  type StagedUploadInput,
  type UploadInput,
} from "../../../shared/attachments/model";
import { uploadMime } from "../../../shared/attachments/upload";
import type { PreviewFile } from "../file-preview/file-format";

export type DraftFile = {
  id: number;
  name: string;
  size: number;
  mime?: string;
  upload?: UploadInput;
  /** A small copy of an image for its chip and hover preview. */
  thumbnail?: string;
  /** The content hash of the copy staged for the host to open, which a send reuses. */
  staged?: string;
};

/**
 * The draft's files in order, by id. Opening a file replaces the list with
 * its staged copy, so the same selection compares by id.
 */
export const draftFileIds = (files?: DraftFile[]) =>
  (files ?? []).map((file) => file.id).join();

/** The hover preview's largest side at 2x pixel density. */
const THUMBNAIL_SIZE = 400;

/** Decodes the image, which also validates it, and scales a small copy. */
async function imageThumbnail(file: File) {
  const image = await createImageBitmap(file);

  const scale = Math.min(
    1,
    THUMBNAIL_SIZE / Math.max(image.width, image.height),
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();

  return canvas.toDataURL("image/webp");
}

export async function loadFile(file: File, name: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = uploadMime(bytes, name);

  if (
    file.type.startsWith("image/") &&
    file.type !== "image/svg+xml" &&
    file.type !== mime
  ) {
    throw new Error("Invalid or unsupported image.");
  }

  let thumbnail;

  if (!mime) {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } else if (mime.startsWith("image/")) {
    thumbnail = await imageThumbnail(file);
  }

  let binary = "";

  for (let i = 0; i < bytes.length; i += 16384) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }

  const upload: UploadInput = {
    source: "upload",
    name,
    summary: `User attached ${name}.`.slice(0, ATTACHMENT_LIMITS.summaryChars),
    data: btoa(binary),
  };

  return { upload, mime, thumbnail };
}

/** Whether the panel can preview the file. Documents have no viewer. */
export const draftPreviewable = ({ mime }: DraftFile) =>
  !mime || mime.startsWith("image/");

/** Decode local text only when its preview opens. Images already have base64 content. */
export function draftPreview(upload: UploadInput, mime?: string): PreviewFile {
  if (mime) return { path: upload.name, content: upload.data, mime_type: mime };

  const bytes = Uint8Array.from(atob(upload.data), (char) =>
    char.charCodeAt(0),
  );

  return {
    path: upload.name,
    content: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
    mime_type: "text/plain",
  };
}

/**
 * The start or send request's `attachments`, left out when there are none. A
 * staged file sends its hash in place of its content.
 */
export function uploadArguments(files: readonly DraftFile[] = []) {
  const attachments = files.flatMap(
    ({ upload, staged }): (UploadInput | StagedUploadInput)[] => {
      if (!upload) return [];
      if (!staged) return [upload];
      const { data: _, ...rest } = upload;

      return [{ ...rest, staged }];
    },
  );

  return attachments.length ? { attachments } : {};
}

export function fileLimit(file: File, prior: DraftFile[]) {
  if (!file.size) return "Empty file or folder.";

  if (prior.length >= ATTACHMENT_LIMITS.count) {
    return `Choose up to ${ATTACHMENT_LIMITS.count} files.`;
  }

  if (
    prior.reduce((sum, item) => sum + item.size, file.size) >
    ATTACHMENT_LIMITS.messageBytes
  ) {
    return `Files exceed ${ATTACHMENT_LIMITS.messageBytes / 1024 / 1024} MiB.`;
  }

  return undefined;
}
