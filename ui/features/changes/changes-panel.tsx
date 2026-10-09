import { END_UNRECORDED } from "../../../src/features/workspaces/changes";
import { useSnapshot } from "../../shared/state/controller-context";
import type { Task } from "../tasks/types";
import { ChangesHeader } from "./changes-header";
import { ChangesView } from "./changes-view";

/** The Changes tab: what the task changed, read live from Git. */
export function ChangesPanel({ task }: { task: Task }) {
  const state = useSnapshot(),
    changes = state.changes?.task === task.id ? state.changes : undefined,
    data = changes?.data,
    loading = changes?.loading ?? (!data && !changes?.error);

  return (
    <div className="changes">
      <ChangesHeader task={task} changes={changes} />
      {changes?.error && (
        <p className="form-error changes-error" role="alert">
          {data &&
            "Couldn’t refresh changes. Showing the last loaded changes. "}
          {changes.error}
        </p>
      )}
      <div className="changes-content" aria-busy={loading}>
        {!data ? (
          loading && (
            <p className="help changes-empty" aria-hidden="true">
              Reading changes…
            </p>
          )
        ) : data.state === "branch_deleted" ? (
          <p className="help changes-empty">
            The worktree and its branch <code>{data.branch}</code> were deleted.
          </p>
        ) : data.state === "end_unrecorded" ? (
          <p className="help changes-empty">{END_UNRECORDED}</p>
        ) : data.state === "workspace_missing" ? (
          <p className="help changes-empty">
            The worktree was removed, so nothing is uncommitted. Its commits are
            on branch <code>{data.branch}</code>.
          </p>
        ) : data.files.length ? (
          <ChangesView task={task} changes={data} />
        ) : (
          <p className="help changes-empty">
            {data.scope === "turn"
              ? "No uncommitted changes from this turn."
              : "No uncommitted changes."}{" "}
            Anything committed is in the Git history.
          </p>
        )}
      </div>
    </div>
  );
}
