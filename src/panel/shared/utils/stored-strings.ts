/** The strings saved under `key`, or none when browser storage can't supply them. */
export function storedStrings(key: string): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");

    return new Set(
      Array.isArray(saved)
        ? saved.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/** Saves `strings` under `key` wherever browser storage is available. */
export function saveStrings(key: string, strings: ReadonlySet<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...strings]));
  } catch {
    // The caller's state still lasts for this session.
  }
}
