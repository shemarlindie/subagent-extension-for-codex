import { useRef } from "react";

import { useSnapshot } from "../../app/state/controller-context";
import { useSessionState } from "../../app/state/session/use-session-state";
import { LoadingSwap } from "../../shared/components/loading-skeleton/loading-swap";
import { useAnimatedHeight } from "../../shared/components/motion/use-animated-height";
import { ScrollLatestButton } from "../../shared/components/scroll-latest-button/scroll-latest-button";
import type { Task } from "../tasks/types";
import { ChangesHeader } from "./changes-header";
import { ChangesHeaderSkeleton, ChangesSkeleton } from "./changes-skeleton";
import { ChangesView } from "./changes-view";
import { useChangesScroll } from "./use-changes-scroll";

type ChangesPanelProps = { task?: Task; taskId?: string };

/** The Changes tab: what the task changed, from recorded tool edits. */
export function ChangesPanel({ task, taskId }: ChangesPanelProps) {
  const id = task?.id ?? taskId ?? "";

  const state = useSnapshot(),
    changes =
      task && state.changes?.task === task.id ? state.changes : undefined,
    data = changes?.data,
    loading = !task || (changes?.loading ?? (!data && !changes?.error)),
    headerLoading = !task || (loading && !data),
    reserveEmptyHeight =
      (!data && loading) || Boolean(data && !data.files.length),
    // Kept per task, so the reader's place survives tab and task switches.
    [reading] = useSessionState("task", id, (state) => state.reading.changes),
    { viewportRef, scrolled, scrollToTop, activePath } = useChangesScroll(
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
            {!headerLoading ? (
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
                {data.unrecorded_commands && (
                  <p className="help changes-note">
                    Some changes made by commands weren't recorded.
                  </p>
                )}
                {data.files.length ? (
                  <ChangesView
                    task={task}
                    changes={data}
                    reading={reading}
                    activePath={activePath}
                  />
                ) : (
                  <p className="help changes-empty">
                    {data.scope === "turn"
                      ? "No recorded edits from this turn."
                      : "No recorded edits."}
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
