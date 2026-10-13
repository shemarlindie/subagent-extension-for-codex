/** Splits items into consecutive groups of `size`; the last may be shorter. */
export function chunks<T>(items: T[], size: number) {
  const groups: T[][] = [];

  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }

  return groups;
}
