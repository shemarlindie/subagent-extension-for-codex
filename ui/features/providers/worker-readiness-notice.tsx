import { providerMetadata } from "../../../src/features/providers/metadata";
import { Notice } from "../../shared/components/notice";
import { useSnapshot } from "../../shared/state/controller-context";

/** Says which workers can't start tasks and how to fix it, such as a missing Claude Code CLI. */
export function WorkerReadinessNotice() {
  const state = useSnapshot();

  const unready = state.workers.filter(
    (worker) => worker.readiness?.ready === false,
  );

  if (!unready.length) return null;

  return (
    <div className="worker-readiness" role="alert">
      {unready.map((worker) => (
        <Notice key={worker.provider} tone="error">
          <strong>
            {providerMetadata(worker.provider, worker.metadata)?.displayName ??
              worker.provider}{" "}
            can't start tasks
          </strong>
          <p>{worker.readiness!.message}</p>
        </Notice>
      ))}
    </div>
  );
}
