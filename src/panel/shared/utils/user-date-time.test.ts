import assert from "node:assert/strict";

import { test } from "vitest";

import { formatUserDateTime } from "./user-date-time";

test("missing or invalid host preferences fall back to the browser's local time", () => {
  const timestamp = "2026-10-08T23:30:45Z";

  const expected = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));

  assert.equal(formatUserDateTime(timestamp), expected);

  assert.equal(
    formatUserDateTime(timestamp, {
      locale: "en-US",
      timeZone: "Invalid/Zone",
    }),
    expected,
  );

  assert.equal(
    formatUserDateTime(timestamp, {
      locale: "invalid_locale",
      timeZone: "Asia/Tokyo",
    }),
    expected,
  );
});

test("full timestamps can omit the zone label, including with invalid host preferences", () => {
  const timestamp = "2026-10-08T23:30:45Z";

  assert.equal(
    formatUserDateTime(
      timestamp,
      {
        locale: "en-US",
        timeZone: "America/Los_Angeles",
      },
      { timeZoneName: undefined },
    ),
    "Oct 8, 2026, 4:30:45 PM",
  );

  assert.equal(
    formatUserDateTime(
      timestamp,
      { timeZone: "Invalid/Zone" },
      { timeZoneName: undefined },
    ),
    new Date(timestamp).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
  );
});
