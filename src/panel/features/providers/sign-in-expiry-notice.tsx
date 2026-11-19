import { useSnapshot } from "../../app/state/controller-context";
import { Notice } from "../../shared/components/notice/notice";
import { formatUserDateTime } from "../../shared/utils/user-date-time";
import type { SignInExpiry } from "./sign-in-expiry";

type SignInExpiryNoticeProps = { expiry: SignInExpiry };

const dateOnly = {
  hour: undefined,
  minute: undefined,
  second: undefined,
  timeZoneName: undefined,
} satisfies Intl.DateTimeFormatOptions;

const renew = <code>claude auth login</code>;

/** Says when Claude's stored claude.ai sign-in ends and how to renew it. */
export function SignInExpiryNotice({ expiry }: SignInExpiryNoticeProps) {
  const host = useSnapshot((state) => state.host);
  const earliest = formatUserDateTime(expiry.earliest, host, dateOnly);
  const latest = formatUserDateTime(expiry.latest, host, dateOnly);

  const content = {
    soon: {
      title: "Claude sign-in ends soon",
      text: (
        <>
          It ends between {earliest} and {latest}, and renewing it doesn't move
          those dates. Run {renew} in a terminal before then.
        </>
      ),
    },
    imminent: {
      title: "Claude sign-in can end at any time",
      text: (
        <>
          It ends by {latest}, and renewing it doesn't move that date. Run{" "}
          {renew} in a terminal now.
        </>
      ),
    },
    ended: {
      title: "Claude sign-in may have ended",
      text: (
        <>
          It may have ended between {earliest} and {latest}. If tasks are
          refused, run {renew} in a terminal.
        </>
      ),
    },
  }[expiry.state];

  return (
    <Notice>
      <strong>{content.title}</strong>
      <p>{content.text}</p>
    </Notice>
  );
}
