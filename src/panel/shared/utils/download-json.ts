/** Downloads JSON as a file, leaving its location to the browser's preferences. */
export function downloadJson(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );

  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // The browser reads the file after this click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
