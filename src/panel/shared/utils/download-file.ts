/** Downloads a file, leaving its location to the browser's preferences. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // The browser reads the file after this click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
