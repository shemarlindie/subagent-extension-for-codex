import { providerMetadata } from "../../../shared/providers/metadata";
import { useSnapshot } from "../../app/state/controller-context";
import { Notice } from "../../shared/components/notice/notice";
import { signInExpiry } from "./sign-in-expiry";
import { SignInExpiryNotice } from "./sign-in-expiry-notice";

/**
 * Says which workers can't start tasks and how to fix it, such as a missing
 * Claude Code CLI, and warns when Claude's sign-in ends within 10 days.
 */
export function WorkerReadinessNotice() {
  const workers = useSnapshot((state) => state.workers);

  const unready = workers.flatMap(({ readiness, ...worker }) =>
    readiness?.ready === false ? [{ ...worker, readiness }] : [],
  );

  const claude = workers.find(({ provider }) => provider === "claude");

  const expiry =
    claude?.readiness?.ready &&
    signInExpiry(claude.readiness.credential_expires_at);

  if (!unready.length && !expiry) return null;

  return (
    <div
      className="worker-readiness"
      role={unready.length ? "alert" : "status"}
    >
      {unready.map((worker) => (
        <Notice key={worker.provider} tone="error">
          <strong>
            {providerMetadata(worker.provider, worker.metadata)?.displayName ??
              worker.provider}{" "}
            can't start tasks
          </strong>
          <p>{worker.readiness.message}</p>
        </Notice>
      ))}
      {expiry && <SignInExpiryNotice expiry={expiry} />}
    </div>
  );
}
