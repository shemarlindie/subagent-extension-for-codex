import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { changeCounts } from "../../../shared/workspaces/changes";
import { useController } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { Progress } from "../file-preview/progress";
import type { Task } from "../tasks/types";
import { changedFileEntries } from "./changed-files";
import { CommandLine } from "./command-line";
import { changesSummary } from "./read-changes";
import type { ChangeScope, ChangesState } from "./types";
import { firstUnviewed, isViewed, useViewedFiles } from "./use-viewed-files";
import { WorktreeActions } from "./worktree-actions";

type ChangesHeaderProps = {
  task: Task;
  changes?: ChangesState;
};

const SCOPES: { value: ChangeScope; label: string }[] = [
  { value: "task", label: "Whole task" },
  { value: "turn", label: "This turn" },
];

export const CURRENT_REPO_CHANGES_NOTE =
  "Uncommitted changes to the files this task changed, including edits to them made outside the task. Committed changes are in the Git history.";

export const WORKTREE_CHANGES_NOTE =
  "Uncommitted changes in the worktree. Committed changes are on the branch: Compare shows them, and Push sends only them, so commit these first to include them.";

/** Where the changes are, how to get at them, and which part is shown. */
export function ChangesHeader({ task, changes }: ChangesHeaderProps) {
  const controller = useController(),
    data = changes?.data,
    removed =
      data?.state === "workspace_missing" || data?.state === "branch_deleted",
    loading = changes?.loading ?? (!data && !changes?.error),
    summary =
      data && !data.state
        ? `${changesSummary(changeCounts(data))} uncommitted`
        : "",
    branch = task.branch,
    [viewed] = useViewedFiles(task.id),
    entries = data && !data.state ? changedFileEntries(data) : [],
    viewedCount = entries.filter((entry) => isViewed(viewed, entry)).length,
    loadingNote = data ? "Refreshing changes…" : "Reading changes…",
    // Preview all picks up where the reader left off.
    resumeAt = firstUnviewed(viewed, entries);

  return (
    <div className="changes-header">
      <div className="changes-toolbar" data-has-scope={task.turn > 1}>
        {/* A task's first turn is the whole task, so the choice waits for a second. */}
        {task.turn > 1 && (
          <ToggleGroup
            className="view-switch"
            aria-label="Changes to show"
            value={[changes?.scope ?? "task"]}
            onValueChange={(value) =>
              value[0] && controller.run(() => controller.loadChanges(value[0]))
            }
          >
            {SCOPES.map((scope) => (
              <Toggle
                key={scope.value}
                value={scope.value}
                className="view-option"
              >
                {scope.label}
              </Toggle>
            ))}
          </ToggleGroup>
        )}
        <div className="changes-summary-row">
          <span className="changes-summary" title={summary}>
            {summary}
          </span>
          {entries.length > 0 && (
            <span className="changes-viewed">
              {viewedCount} of {entries.length} viewed
            </span>
          )}
          <span className="changes-status" role="status" data-initial={!data}>
            {loading ? loadingNote : ""}
          </span>
        </div>
        {resumeAt && (
          <Button
            variant="ghost"
            className="changes-preview-all"
            aria-label="Preview all changes"
            onClick={() =>
              controller.open({ kind: "file", task, path: resumeAt.file.path })
            }
          >
            <Icon name="eye" size={14} />
            Preview all
          </Button>
        )}
        <TooltipWrapper label="Refresh changes">
          <Button
            variant="ghost"
            className="toolbar-icon-button changes-refresh"
            aria-label="Refresh changes"
            disabled={loading}
            onClick={() => controller.run(() => controller.loadChanges())}
          >
            <Icon name="refresh" size={14} />
          </Button>
        </TooltipWrapper>
        {loading && data && <Progress label="Refreshing changes" />}
      </div>
      {task.workspace_strategy === "current_repo"
        ? data?.state !== "end_unrecorded" && (
            <p className="help changes-note">{CURRENT_REPO_CHANGES_NOTE}</p>
          )
        : branch &&
          data?.state !== "branch_deleted" && (
            <div className="changes-commands">
              <CommandLine label="Branch" command={branch} />
              {removed ? (
                <CommandLine
                  label="Check out"
                  command={`git checkout ${branch}`}
                />
              ) : (
                task.workspace && (
                  <CommandLine
                    label="Worktree"
                    command={`cd ${task.workspace}`}
                  />
                )
              )}
              {task.base_commit && (
                <CommandLine
                  label="Compare"
                  command={`git diff ${task.base_commit}...${branch}`}
                />
              )}
              <CommandLine
                label="Push"
                command={`git push -u origin ${branch}`}
              />
              {!removed && (
                <p className="help changes-note">{WORKTREE_CHANGES_NOTE}</p>
              )}
            </div>
          )}
      {task.workspace_strategy === "worktree" &&
        branch &&
        data?.state !== "branch_deleted" && (
          <div className="changes-worktree-actions">
            <WorktreeActions task={task} changes={changes} />
          </div>
        )}
    </div>
  );
}
