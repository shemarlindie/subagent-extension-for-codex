import type { DownloadFile } from "../state/types";

/** Saves a file from a top-level page, where the browser allows downloads. */
export function saveInBrowser(file: DownloadFile) {
  const body =
    file.base64 === undefined
      ? file.text
      : Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));

  const url = URL.createObjectURL(new Blob([body], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // Revoke after the click is handled; some browsers read the URL asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
