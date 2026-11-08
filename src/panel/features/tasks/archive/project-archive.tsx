import { useCallback, useEffect, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { Checkbox } from "../../../shared/components/checkbox/checkbox";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { LoadingSpinner } from "../../../shared/components/loading-spinner/loading-spinner";
import { Presence } from "../../../shared/components/motion/presence";
import { BackButton } from "../../../shared/components/navigation/back-button";
import { PageFrame } from "../../../shared/components/navigation/page-frame";
import { ArchiveDeleteConfirm } from "./archive-delete-confirm";
import { ArchivedTaskRow } from "./archived-task-row";

type ProjectArchiveProps = {
  repository: string;
  name: string;
  onBack: () => void;
};

/**
 * A project's archived tasks from every chat, newest archive first. The user
 * unarchives or deletes the selected tasks, or all of them when none are
 * selected. It reads its own list because the task list leaves archived
 * tasks out and may be scoped to another project.
 */
export function ProjectArchive({
  repository,
  name,
  onBack,
}: ProjectArchiveProps) {
  const controller = useController(),
    state = useSnapshot(),
    [tasks, setTasks] = useState<Task[]>(),
    [checked, setChecked] = useState<ReadonlySet<string>>(new Set()),
    [confirming, setConfirming] = useState(false),
    [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const { tasks: listed } = await controller.tool<{ tasks: Task[] }>(
      "app_list_tasks",
      { conversation_id: null, repository, archived: "only" },
    );

    const archived = listed.sort((a, b) =>
      b.archived_at!.localeCompare(a.archived_at!),
    );

    setTasks(archived);

    setChecked(
      (ids) =>
        new Set(archived.filter((task) => ids.has(task.id)).map((t) => t.id)),
    );
  }, [controller, repository]);

  // Undo can change the archive from outside this page, so it reads again.
  useEffect(() => controller.run(load), [controller, load, state.undoRevision]);

  const listed = tasks ?? [],
    targets = checked.size
      ? listed.filter((task) => checked.has(task.id))
      : listed,
    scope = checked.size ? "selected" : "all",
    disabled = pending || state.busy || !state.connected;

  // Runs a change, then reads the archive again for what the service did.
  const act = (action: () => Promise<unknown>) =>
    controller.run(async () => {
      setPending(true);

      try {
        await action();
      } finally {
        setPending(false);
        controller.run(load);
      }
    });

  const unarchive = () =>
    act(() => controller.taskActions.archive.setArchived(targets, false));

  const remove = (deleteAgentTasks: boolean) =>
    act(async () => {
      await controller.tool("app_delete_tasks", {
        task_ids: targets.map((task) => task.id),
        delete_agent_task: deleteAgentTasks,
      });

      setConfirming(false);
      await controller.refresh();
    });

  const check = (id: string, value: boolean) =>
    setChecked((ids) => {
      const next = new Set(ids);

      if (value) next.add(id);
      else next.delete(id);

      return next;
    });

  return (
    <PageFrame
      title={`${name} archive`}
      headingId="project-archive-heading"
      back={<BackButton label="Projects" disabled={pending} onClick={onBack} />}
    >
      <div className="project-archive">
        {listed.length > 0 && (
          <p className="form-note">
            Includes tasks archived from any chat in this project.
          </p>
        )}
        <LoadingSwap loading={!tasks} skeleton={<LoadingSpinner />}>
          {listed.length ? (
            <>
              <div className="project-archive-toolbar">
                <label className="project-archive-select">
                  <Checkbox
                    checked={checked.size === listed.length}
                    indeterminate={
                      checked.size > 0 && checked.size < listed.length
                    }
                    disabled={disabled}
                    onCheckedChange={(value) =>
                      setChecked(
                        new Set(value ? listed.map((task) => task.id) : []),
                      )
                    }
                  />
                  {checked.size
                    ? `${checked.size} of ${listed.length} selected`
                    : `${listed.length} archived`}
                </label>
                <div className="project-archive-actions">
                  <Button
                    disabled={disabled || confirming}
                    data-action="unarchive"
                    onClick={unarchive}
                  >
                    Unarchive {scope}
                  </Button>
                  <Button
                    className="archive-delete"
                    disabled={disabled || confirming}
                    data-action="delete"
                    onClick={() => setConfirming(true)}
                  >
                    Delete {scope}
                  </Button>
                </div>
              </div>
              <Presence show={confirming}>
                <ArchiveDeleteConfirm
                  count={targets.length}
                  pending={disabled}
                  onCancel={() => setConfirming(false)}
                  onConfirm={remove}
                />
              </Presence>
              <ul className="archived-tasks" aria-label="Archived tasks">
                {listed.map((task) => (
                  <ArchivedTaskRow
                    key={task.id}
                    task={task}
                    checked={checked.has(task.id)}
                    disabled={disabled || confirming}
                    onCheckedChange={(value) => check(task.id, value)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <p className="help empty-state">
              Tasks you archive in any chat in this project appear here.
            </p>
          )}
        </LoadingSwap>
      </div>
    </PageFrame>
  );
}
