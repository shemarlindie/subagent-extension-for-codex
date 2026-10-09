import { END_UNRECORDED } from "../../../shared/workspaces/changes";
import { useSnapshot } from "../../app/state/controller-context";
import { useSessionState } from "../../app/state/session/use-session-state";
import type { Task } from "../tasks/types";
import { ChangesHeader } from "./changes-header";
import { ChangesView } from "./changes-view";
import { useChangesScroll } from "./use-changes-scroll";

/** The Changes tab: what the task changed, read live from Git. */
export function ChangesPanel({ task }: { task: Task }) {
  const state = useSnapshot(),
    changes = state.changes?.task === task.id ? state.changes : undefined,
    data = changes?.data,
    loading = changes?.loading ?? (!data && !changes?.error),
    // Kept per task, so the reader's place survives tab and task switches.
    [reading] = useSessionState(
      "task",
      task.id,
      (state) => state.reading.changes,
    ),
    viewportRef = useChangesScroll(reading, Boolean(data));

  return (
    <div className="changes" ref={viewportRef}>
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
          <ChangesView task={task} changes={data} reading={reading} />
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
