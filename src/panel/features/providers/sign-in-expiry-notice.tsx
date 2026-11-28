import { providerMetadata } from "../../../core/shared/providers/metadata";
import { useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { Notice } from "../../shared/components/notice/notice";
import {
  formatUserDateTime,
  type UserDateTimePreferences,
} from "../../shared/utils/user-date-time";
import { signInExpiry, type SignInExpiry } from "./sign-in-expiry";
import type { Worker } from "./types";
import { useSignInExpiryDismissal } from "./use-sign-in-expiry-dismissal";

const dateOnly = {
  hour: undefined,
  minute: undefined,
  second: undefined,
  timeZoneName: undefined,
} satisfies Intl.DateTimeFormatOptions;

type ExpiringSignIn = { name: string; command: string; expiry: SignInExpiry };

/**
 * Says when a ready worker's stored sign-in ends and how to sign in again,
 * from 10 days before. Dismissing hides it for a day.
 */
export function SignInExpiryNotice({ worker }: { worker: Worker }) {
  const host = useSnapshot((state) => state.host);
  const { hidden, dismiss } = useSignInExpiryDismissal(worker.provider);
  const metadata = providerMetadata(worker.provider, worker.metadata);

  const expiry = worker.readiness?.ready
    ? signInExpiry(worker.readiness.credential_expires_at)
    : undefined;

  const signIn =
    metadata?.signInCommand && expiry
      ? {
          name: metadata.displayName,
          command: metadata.signInCommand,
          expiry,
        }
      : undefined;

  return (
    <Presence show={Boolean(signIn) && !hidden}>
      {signIn && (
        <div className="worker-readiness" role="status">
          <Notice className="sign-in-expiry">
            <p>{expiryText(signIn, host)}</p>
            <Button variant="text" onClick={dismiss}>
              Dismiss
            </Button>
          </Notice>
        </div>
      )}
    </Presence>
  );
}

/** The notice text, with the date in the host's zone. */
function expiryText(
  { name, command, expiry }: ExpiringSignIn,
  host: UserDateTimePreferences,
) {
  const date = formatUserDateTime(expiry.endsAt, host, dateOnly);
  const signIn = <code>{command}</code>;

  return expiry.ended ? (
    <>
      {name} sign-in may have ended. If tasks are refused, run {signIn} in a
      terminal to sign in again.
    </>
  ) : (
    <>
      {name} sign-in ends by {date}. Run {signIn} in a terminal to sign in
      again.
    </>
  );
}
