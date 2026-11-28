/**
 * Text for an untyped value, such as a provider event field: a string, number
 * or boolean as `String` writes it, otherwise `fallback`. Objects never render
 * as `[object Object]`.
 */
export function scalarText(value: unknown, fallback = ""): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : fallback;
}

/** A setting key or scope as a label: `worker_profile` reads "Worker profile". */
export const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
