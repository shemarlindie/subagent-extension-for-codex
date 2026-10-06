import { useSnapshot } from "../../shared/state/controller-context";
import { Progress } from "../file-preview/components/progress";
import type { Task } from "../tasks/types";
import { ChangesHeader } from "./changes-header";
import { ChangesView } from "./changes-view";

/** The Changes tab: what the task changed, read live from Git. */
export function ChangesPanel({ task }: { task: Task }) {
  const state = useSnapshot(),
    changes = state.changes?.task === task.id ? state.changes : undefined,
    data = changes?.data;

  return (
    <div className="changes">
      <ChangesHeader task={task} changes={changes} />
      {changes?.error ? (
        <p className="form-error changes-error" role="alert">
          {changes.error}
        </p>
      ) : !data ? (
        <Progress label="Reading changes" className="changes-loading" />
      ) : data.state === "workspace_missing" ? (
        <p className="help changes-empty">
          The worktree was removed. Changes are on branch{" "}
          <code>{data.branch}</code>.
        </p>
      ) : data.files.length ? (
        <ChangesView changes={data} />
      ) : (
        <p className="help changes-empty">
          {data.scope === "turn" ? "No changes in this turn." : "No changes."}
        </p>
      )}
    </div>
  );
}
