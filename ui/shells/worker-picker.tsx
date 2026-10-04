import { useController, useSnapshot } from "../components/controller-context";
import { SelectField } from "../components/select-field";
import { profileLabel } from "../core/selectors";

export function WorkerPicker() {
  const controller = useController(),
    state = useSnapshot();

  return (
    <>
      <label htmlFor="worker-view">Worker</label>
      <SelectField
        id="worker-view"
        label="Worker"
        value={state.workerRoute ?? ""}
        options={[
          { value: "", label: "All workers" },
          ...state.workers.flatMap((worker) =>
            worker.profiles.map((profile) => ({
              value: `${worker.provider}.${profile}`,
              label: `${worker.provider} · ${profileLabel(profile)}`,
            })),
          ),
        ]}
        onValueChange={(value) =>
          controller.run(() => controller.chooseWorker(value || undefined))
        }
      />
      <div className="statusline" id="provider-status">
        {state.workers
          .map((worker) =>
            worker.provider === "fixture"
              ? "Fixture · no model calls"
              : worker.provider === "codex"
                ? "Codex · OpenAI Agents API"
                : "Claude Agent SDK",
          )
          .join(" · ")}
      </div>
    </>
  );
}
