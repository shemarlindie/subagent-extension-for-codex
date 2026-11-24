import {
  ATTACHMENT_LIMITS,
  type UploadInput,
} from "../../../shared/attachments/model";
import { uploadMime } from "../../../shared/attachments/upload";

export type ComposerFile = {
  id: number;
  name: string;
  size: number;
  upload?: UploadInput;
};

export async function loadFile(file: File, name: string): Promise<UploadInput> {
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

  return {
    source: "upload",
    name,
    summary: `User attached ${name}.`.slice(0, ATTACHMENT_LIMITS.summaryChars),
    data: btoa(binary),
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
