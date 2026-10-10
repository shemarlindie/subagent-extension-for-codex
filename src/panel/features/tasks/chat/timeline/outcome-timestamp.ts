import type { UserDateTimePreferences } from "../../../../shared/utils/user-date-time.js";

/** Compare calendar days in the same zone used to display the response. */
export function formatOutcomeTimestamp(
  timestamp: string,
  preferences: UserDateTimePreferences = {},
  now = new Date(),
) {
  const date = new Date(timestamp);

  const format = (preferences: UserDateTimePreferences) => {
    const dayOptions = { timeZone: preferences.timeZone };

    const today =
      date.toLocaleDateString(preferences.locale, dayOptions) ===
      now.toLocaleDateString(preferences.locale, dayOptions);

    const yearOptions: Intl.DateTimeFormatOptions = {
      ...dayOptions,
      year: "numeric",
    };

    const currentYear =
      date.toLocaleDateString(preferences.locale, yearOptions) ===
      now.toLocaleDateString(preferences.locale, yearOptions);

    return date.toLocaleString(preferences.locale, {
      timeZone: preferences.timeZone,
      ...(!today && { month: "short", day: "numeric" }),
      ...(!currentYear && { year: "numeric" }),
      hour: "numeric",
      minute: "2-digit",
    });
  };

  try {
    return format(preferences);
  } catch {
    return format({});
  }
}
