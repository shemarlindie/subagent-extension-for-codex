const compactCount = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Counts up to 999 as digits; larger counts abbreviate, such as 1.1K or 2K. */
export function formatCount(count: number) {
  return compactCount.format(count);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
