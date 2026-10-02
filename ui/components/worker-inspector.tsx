import { profileLabel } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
export function WorkerInspector() {
  const controller = useController(),
    state = useSnapshot();
  const worker = state.workers.find((worker) =>
    worker.profiles.some(
      (profile) => `${worker.provider}.${profile}` === state.workerRoute,
    ),
  );
  if (!worker)
    return (
      <div className="empty">
        <h2>Worker unavailable</h2>
        <p>Select an available worker from the list.</p>
      </div>
    );
  const profile = state.workerRoute!.slice(worker.provider.length + 1),
    readOnly = ["researcher", "reviewer", "security_reviewer"].includes(
      profile,
    );
  return (
    <>
      <span className="eyebrow">Available worker</span>
      <h2>
        {worker.provider} · {profileLabel(profile)}
      </h2>
      <p>
        {readOnly
          ? "Inspects the selected workspace without editing source files."
          : "Can edit the selected workspace and request execution permission."}
      </p>
      <button
        className="primary"
        onClick={() =>
          controller.run(() =>
            controller.delegate(`${worker.provider}:${profile}`),
          )
        }
      >
        Delegate to this worker
      </button>
      <h3>Capabilities</h3>
      <div className="metadata">
        {Object.entries(worker.capabilities).map(([name, supported]) => (
          <div key={name}>
            <span>{profileLabel(name)}</span>
            {supported ? "Supported" : "Unavailable"}
          </div>
        ))}
      </div>
    </>
  );
}
