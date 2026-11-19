import { useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { Notice } from "../../shared/components/notice/notice";
import {
  formatUserDateTime,
  type UserDateTimePreferences,
} from "../../shared/utils/user-date-time";
import { signInExpiry, type SignInExpiry } from "./sign-in-expiry";
import { useSignInExpiryDismissal } from "./use-sign-in-expiry-dismissal";

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

  const { hidden, dismiss } = useSignInExpiryDismissal();

  const expiry = claude?.readiness?.ready
    ? signInExpiry(claude.readiness.credential_expires_at)
    : undefined;

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

/** The notice text, with the date in the host's zone. */
function expiryText(expiry: SignInExpiry, host: UserDateTimePreferences) {
  const date = formatUserDateTime(expiry.endsAt, host, dateOnly);

  return expiry.ended ? (
    <>
      Claude sign-in may have ended on {date}. If tasks are refused, run {renew}{" "}
      in a terminal.
    </>
  ) : (
    <>
      Claude sign-in ends by {date}. Run {renew} in a terminal to renew it.
    </>
  );
}
