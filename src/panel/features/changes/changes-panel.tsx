import { useRef } from "react";

import { END_UNRECORDED } from "../../../shared/workspaces/changes";
import { useSnapshot } from "../../app/state/controller-context";
import { useSessionState } from "../../app/state/session/use-session-state";
import { LoadingSwap } from "../../shared/components/loading-skeleton/loading-swap";
import { useAnimatedHeight } from "../../shared/components/motion/motion";
import { ScrollLatestButton } from "../../shared/components/scroll-latest-button/scroll-latest-button";
import type { Task } from "../tasks/types";
import { ChangesHeader } from "./changes-header";
import { ChangesHeaderSkeleton, ChangesSkeleton } from "./changes-skeleton";
import { ChangesView } from "./changes-view";
import { useChangesScroll } from "./use-changes-scroll";

type ChangesPanelProps = { task?: Task; taskId?: string };

/** The Changes tab: what the task changed, read live from Git. */
export function ChangesPanel({ task, taskId }: ChangesPanelProps) {
  const id = task?.id ?? taskId ?? "";

  const state = useSnapshot(),
    changes =
      task && state.changes?.task === task.id ? state.changes : undefined,
    data = changes?.data,
    loading = !task || (changes?.loading ?? (!data && !changes?.error)),
    headerLoading = !task || (loading && !data),
    reserveEmptyHeight =
      (!data && loading) || Boolean(data && (data.state || !data.files.length)),
    // Kept per task, so the reader's place survives tab and task switches.
    [reading] = useSessionState("task", id, (state) => state.reading.changes),
    { viewportRef, scrolled, scrollToTop } = useChangesScroll(
      reading,
      Boolean(data),
      Boolean(data?.files.length),
    ),
    headerRef = useRef<HTMLDivElement>(null);

  useAnimatedHeight(headerRef, headerLoading);

  return (
    <div className="changes" ref={viewportRef}>
      <div className="changes-scroll-top-anchor">
        <ScrollLatestButton
          show={Boolean(data) && scrolled}
          direction="up"
          label="Scroll to top"
          className="changes-scroll-top"
          onClick={scrollToTop}
        />
      </div>
      <div className="changes-body">
        <div ref={headerRef}>
          <LoadingSwap
            className="changes-header-loading-swap"
            loading={headerLoading}
            busy={false}
            skeleton={<ChangesHeaderSkeleton />}
          >
            {!headerLoading && task ? (
              <ChangesHeader task={task} changes={changes} />
            ) : null}
          </LoadingSwap>
        </div>
        {changes?.error && (
          <p className="form-error changes-error" role="alert">
            {data &&
              "Couldn’t refresh changes. Showing the last loaded changes. "}
            {changes.error}
          </p>
        )}
        <div
          className="changes-content"
          data-preserve-empty-height={reserveEmptyHeight || undefined}
          aria-busy={loading}
        >
          <LoadingSwap
            loading={!data && loading}
            busy={false}
            skeleton={<ChangesSkeleton />}
          >
            {data && task ? (
              <>
                {data.state === "branch_deleted" ? (
                  <p className="help changes-empty">
                    The worktree and its branch <code>{data.branch}</code> were
                    deleted.
                  </p>
                ) : data.state === "end_unrecorded" ? (
                  <p className="help changes-empty">{END_UNRECORDED}</p>
                ) : data.state === "workspace_missing" ? (
                  <p className="help changes-empty">
                    The worktree was removed, so nothing is uncommitted. Its
                    commits are on branch <code>{data.branch}</code>.
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
              </>
            ) : null}
          </LoadingSwap>
        </div>
      </div>
    </div>
  );
}
