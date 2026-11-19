import { providerMetadata } from "../../../shared/providers/metadata";
import { useSnapshot } from "../../app/state/controller-context";
import { Notice } from "../../shared/components/notice/notice";
import { SignInExpiryNotice } from "./sign-in-expiry-notice";

/**
 * Says which workers can't start tasks and how to fix it, such as a missing
 * Claude Code CLI, and warns when Claude's sign-in ends soon.
 */
export function WorkerReadinessNotice() {
  const workers = useSnapshot((state) => state.workers);

  const unready = workers.flatMap(({ readiness, ...worker }) =>
    readiness?.ready === false ? [{ ...worker, readiness }] : [],
  );

  return (
    <>
      {unready.length > 0 && (
        <div className="worker-readiness" role="alert">
          {unready.map((worker) => (
            <Notice key={worker.provider} tone="error">
              <strong>
                {providerMetadata(worker.provider, worker.metadata)
                  ?.displayName ?? worker.provider}{" "}
                can't start tasks
              </strong>
              <p>{worker.readiness.message}</p>
            </Notice>
          ))}
        </div>
      )}
      <SignInExpiryNotice />
    </>
  );
}
