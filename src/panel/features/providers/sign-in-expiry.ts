const DAY_MS = 86_400_000;
/** Claude Code starts warning this long before a sign-in ends. */
const WARN_MS = 10 * DAY_MS;
/** A sign-in can end up to this long before its reported date. */
const EARLY_MS = 3 * DAY_MS;

export type SignInExpiry = {
  state: "soon" | "imminent" | "ended";
  /** The earliest and latest times the sign-in can end, as ISO 8601 instants. */
  earliest: string;
  latest: string;
};

/**
 * How close a sign-in ending at `expiresAt` is, following Claude Code's own
 * warning. Undefined when unknown or more than 10 days away.
 */
export function signInExpiry(
  expiresAt: string | undefined,
  now = Date.now(),
): SignInExpiry | undefined {
  if (!expiresAt) return;
  const latest = Date.parse(expiresAt);
  // An unparsable date fails this check too.
  if (!(latest - now < WARN_MS)) return;
  const earliest = latest - EARLY_MS;

  return {
    state: expiryState(earliest, latest, now),
    earliest: new Date(earliest).toISOString(),
    latest: new Date(latest).toISOString(),
  };
}

/**
 * The next time after `now` when `signInExpiry` gives a different answer: when
 * the warning starts, when the end becomes imminent, and when it passes.
 */
export function nextExpiryChange(
  expiresAt: string | undefined,
  now = Date.now(),
): number | undefined {
  if (!expiresAt) return;
  const latest = Date.parse(expiresAt);

  return [latest - WARN_MS, latest - EARLY_MS - DAY_MS, latest].find(
    (time) => time > now,
  );
}

function expiryState(earliest: number, latest: number, now: number) {
  if (latest <= now) return "ended";
  if (earliest - now < DAY_MS) return "imminent";

  return "soon";
}
