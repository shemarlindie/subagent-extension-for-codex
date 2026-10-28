import assert from "node:assert/strict";

import { test } from "vitest";

import { formatOutcomeTimestamp } from "./outcome-timestamp";

const preferences = {
  locale: "en-US",
  timeZone: "America/Los_Angeles",
};

test("today's response shows only its time in the user's zone", () => {
  assert.equal(
    formatOutcomeTimestamp(
      "2026-10-09T18:30:00Z",
      preferences,
      new Date("2026-10-10T01:00:00Z"),
    ),
    "11:30 AM",
  );
});

test("a response from a previous local day shows its full date and time", () => {
  assert.equal(
    formatOutcomeTimestamp(
      "2026-10-09T06:30:00Z",
      preferences,
      new Date("2026-10-09T08:00:00Z"),
    ),
    "Oct 8, 11:30 PM",
  );
});

test("same month and day in a different year is not today", () => {
  assert.equal(
    formatOutcomeTimestamp(
      "2025-10-09T18:30:00Z",
      preferences,
      new Date("2026-10-09T18:30:00Z"),
    ),
    "Oct 9, 2025, 11:30 AM",
  );
});

test("the user's local year controls whether the year is shown around New Year", () => {
  assert.equal(
    formatOutcomeTimestamp(
      "2025-01-02T20:00:00Z",
      preferences,
      new Date("2026-01-01T01:00:00Z"),
    ),
    "Jan 2, 12:00 PM",
  );

  assert.equal(
    formatOutcomeTimestamp(
      "2026-01-01T06:00:00Z",
      preferences,
      new Date("2026-01-01T09:00:00Z"),
    ),
    "Dec 31, 2025, 10:00 PM",
  );
});

test("invalid host preferences use the browser's local clock", () => {
  const timestamp = "2026-10-09T18:30:00Z";
  const now = new Date(timestamp);

  const expected = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  for (const preferences of [
    { timeZone: "Invalid/Zone" },
    { locale: "invalid_locale" },
  ]) {
    assert.equal(formatOutcomeTimestamp(timestamp, preferences, now), expected);
  }
});
