import {
  ATTACHMENT_LIMITS,
  type UploadInput,
} from "../../../shared/attachments/model";
import { uploadMime } from "../../../shared/attachments/upload";
import type { PreviewFile } from "../file-preview/file-format";

export type ComposerFile = {
  id: number;
  name: string;
  size: number;
  mime?: string;
  upload?: UploadInput;
};

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

  if (mime) {
    const image = await createImageBitmap(file);
    image.close();
  } else {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

  return { upload, mime };
}

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

export function fileLimit(file: File, prior: ComposerFile[]) {
  if (!file.size) return "Empty file or folder.";

  if (file.size > ATTACHMENT_LIMITS.referenceBytes) {
    return "File exceeds 2 MiB.";
  }

  if (prior.length >= ATTACHMENT_LIMITS.count) return "Choose up to 20 files.";

  if (
    prior.reduce((sum, item) => sum + item.size, file.size) >
    ATTACHMENT_LIMITS.messageBytes
  ) {
    return "Files exceed 10 MiB.";
  }

  return undefined;
}
