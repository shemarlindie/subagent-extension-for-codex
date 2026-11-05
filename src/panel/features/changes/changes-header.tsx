import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { changeCounts } from "../../../shared/changes/changes";
import { useController } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { CommandLine } from "../../shared/components/command-line/command-line";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { Progress } from "../file-preview/progress";
import type { Task } from "../tasks/types";
import { changedFileEntries } from "./changed-files";
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

const CHANGES_NOTE =
  "Edits recorded from this task's tools, including committed edits. File previews show the file as it is now.";

/** Where the changes are, how to get at them, and which part is shown. */
export function ChangesHeader({ task, changes }: ChangesHeaderProps) {
  const controller = useController(),
    data = changes?.data,
    removed = task.workspace_removed,
    loading = changes?.loading ?? (!data && !changes?.error),
    summary = data ? changesSummary(changeCounts(data)) : "",
    branch = task.branch,
    [viewed] = useViewedFiles(task.id),
    entries = data ? changedFileEntries(data) : [],
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
      <p className="help changes-note">{CHANGES_NOTE}</p>
      {task.workspace_removed && (
        <p className="help changes-note">
          The worktree was removed. Recorded edits remain available.
        </p>
      )}
      {task.workspace_strategy === "worktree" &&
        branch &&
        !task.branch_deleted && (
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
          </div>
        )}
      {task.workspace_strategy === "worktree" &&
        branch &&
        !task.branch_deleted && (
          <div className="changes-worktree-actions">
            <WorktreeActions task={task} changes={changes} />
          </div>
        )}
    </div>
  );
}
