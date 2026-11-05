/** Downloads text as a file, leaving its location to the browser's preferences. */
export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // The browser reads the file after this click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
