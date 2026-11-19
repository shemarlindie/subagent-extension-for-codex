/** Claude Code starts warning this long before a sign-in ends. */
const WARN_MS = 10 * 86_400_000;

export type SignInExpiry = {
  /** When the sign-in ends, as an ISO 8601 instant. */
  endsAt: string;
  ended: boolean;
};

/**
 * Whether to warn about a sign-in ending at `expiresAt`, following Claude
 * Code's own warning. Undefined when unknown or more than 10 days away.
 */
export function signInExpiry(
  expiresAt: string | undefined,
  now = Date.now(),
): SignInExpiry | undefined {
  if (!expiresAt) return;
  const endsAt = Date.parse(expiresAt);
  // An unparsable date fails this check too.
  if (!(endsAt - now <= WARN_MS)) return;

  return { endsAt: expiresAt, ended: endsAt <= now };
}
