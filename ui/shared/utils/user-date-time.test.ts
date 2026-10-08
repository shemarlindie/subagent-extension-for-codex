import assert from "node:assert/strict";

import { test } from "vitest";

import { formatUserDateTime } from "./user-date-time";

test("completion times follow the user's zone across daylight saving changes", () => {
  const preferences = {
    locale: "en-US",
    timeZone: "America/Los_Angeles",
  };

  assert.equal(
    formatUserDateTime("2026-07-08T19:30:45Z", preferences),
    "Jul 8, 2026, 12:30:45 PM PDT",
  );

  assert.equal(
    formatUserDateTime("2026-01-08T19:30:45Z", preferences),
    "Jan 8, 2026, 11:30:45 AM PST",
  );
});

test("completion dates follow the user's local calendar day", () => {
  assert.equal(
    formatUserDateTime("2026-10-08T23:30:45Z", {
      locale: "en-US",
      timeZone: "Asia/Tokyo",
    }),
    "Oct 9, 2026, 8:30:45 AM GMT+9",
  );
});

test("completion times use the host's locale and clock format", () => {
  assert.equal(
    formatUserDateTime("2026-10-08T23:30:45Z", {
      locale: "fr-FR",
      timeZone: "Europe/Paris",
    }),
    "9 oct. 2026, 1:30:45 UTC+2",
  );
});

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
