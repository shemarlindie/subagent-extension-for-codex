import { useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { Notice } from "../../shared/components/notice/notice";
import {
  formatUserDateTime,
  type UserDateTimePreferences,
} from "../../shared/utils/user-date-time";
import type { SignInExpiry } from "./sign-in-expiry";
import { useSignInExpiry } from "./use-sign-in-expiry";

const dateOnly = {
  hour: undefined,
  minute: undefined,
  second: undefined,
  timeZoneName: undefined,
} satisfies Intl.DateTimeFormatOptions;

const renew = <code>claude auth login</code>;

/**
 * Says when Claude's stored claude.ai sign-in ends and how to renew it, from 10
 * days before. Dismissing hides it for a day.
 */
export function SignInExpiryNotice() {
  const workers = useSnapshot((state) => state.workers);
  const host = useSnapshot((state) => state.host);
  const claude = workers.find(({ provider }) => provider === "claude");

  const { expiry, hidden, dismiss } = useSignInExpiry(
    claude?.readiness?.ready
      ? claude.readiness.credential_expires_at
      : undefined,
  );

  return (
    <Presence show={Boolean(expiry) && !hidden}>
      {expiry && (
        <div className="worker-readiness" role="status">
          <Notice className="sign-in-expiry">
            <p>{expiryText(expiry, host)}</p>
            <Button variant="text" onClick={dismiss}>
              Dismiss
            </Button>
          </Notice>
        </div>
      )}
    </Presence>
  );
}

/** The notice text for how close the sign-in's end is, with dates in the host's zone. */
function expiryText(expiry: SignInExpiry, host: UserDateTimePreferences) {
  const earliest = formatUserDateTime(expiry.earliest, host, dateOnly);
  const latest = formatUserDateTime(expiry.latest, host, dateOnly);

  if (expiry.state === "ended") {
    return (
      <>
        Claude sign-in may have ended between {earliest} and {latest}. If tasks
        are refused, run {renew} in a terminal.
      </>
    );
  }

  if (expiry.state === "imminent") {
    return (
      <>
        Claude sign-in can end any time before {latest}, and renewing doesn't
        move that date. Run {renew} in a terminal now.
      </>
    );
  }

  return (
    <>
      Claude sign-in ends between {earliest} and {latest}, and renewing doesn't
      move these dates. Run {renew} in a terminal before then.
    </>
  );
}
