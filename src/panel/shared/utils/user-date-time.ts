export type UserDateTimePreferences = {
  locale?: string;
  timeZone?: string;
};

const options: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
};

/** Host preferences take precedence; standalone pages use the browser's zone. */
export function formatUserDateTime(
  timestamp: string,
  preferences: UserDateTimePreferences = {},
  formatOptions: Intl.DateTimeFormatOptions = {},
) {
  const date = new Date(timestamp);
  const dateOptions = { ...options, ...formatOptions };

  try {
    return date.toLocaleString(preferences.locale, {
      ...dateOptions,
      timeZone: preferences.timeZone,
    });
  } catch {
    // An unsupported host locale or zone must not prevent the chat from rendering.
    return date.toLocaleString(undefined, dateOptions);
  }
}
