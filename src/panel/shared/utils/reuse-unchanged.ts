export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;

const idOf = (item: unknown) =>
  isPlainObject(item) &&
  (typeof item.id === "string" || typeof item.id === "number")
    ? item.id
    : undefined;

/**
 * Returns `next`, keeping `previous` or any part of it that holds equal data,
 * so selections of unchanged data keep their references. Array items with an
 * `id` match by id, so an insertion or reorder keeps the other items. Other
 * items match by position.
 */
export function reuseUnchanged<T>(previous: unknown, next: T): T {
  if (previous === next) return next;

  if (Array.isArray(previous) && Array.isArray(next)) {
    return reuseItems(previous, next) as T;
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    return reuseFields(previous, next) as T;
  }

  return next;
}

function reuseItems(previous: unknown[], next: unknown[]) {
  const byId = new Map(previous.map((item) => [idOf(item), item]));

  const items = next.map((item, index) => {
    const id = idOf(item);

    return reuseUnchanged(
      id === undefined ? previous[index] : byId.get(id),
      item,
    );
  });

  const unchanged =
    items.length === previous.length &&
    items.every((item, index) => item === previous[index]);

  return unchanged ? previous : items;
}

function reuseFields(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  const keys = Object.keys(next);

  const fields = Object.fromEntries(
    keys.map((key) => [key, reuseUnchanged(previous[key], next[key])]),
  );

  const unchanged =
    keys.length === Object.keys(previous).length &&
    keys.every(
      (key) => Object.hasOwn(previous, key) && fields[key] === previous[key],
    );

  return unchanged ? previous : fields;
}
