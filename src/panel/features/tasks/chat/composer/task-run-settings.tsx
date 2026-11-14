import { useLayoutEffect, useRef } from "react";

import { shortPermissionLabel } from "../../../../../shared/providers/claude/permissions";
import { providerTaskFacts } from "../../../../../shared/providers/presentation";
import type { ModelChoice } from "../../../../../shared/providers/types";
import { titleCase } from "../../../../../shared/text";
import { useSnapshot } from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { compactPermissionLabel } from "../../../delegation/permission-label";
import {
  compactReasoningLabel,
  modelName,
} from "../../../delegation/setting-labels";
import { WorkerProfileIcon } from "../../list/worker-profile-icon";

type TaskRunSettingsProps = { task: Task; collapsed?: boolean };

/** A setting's label and the abbreviation shown for it. Without one, it stays unshown. */
type RunSetting = { label: string; compact?: string };

/** The settings shown after the profile, in order. */
function runSettings(task: Task, models: readonly ModelChoice[]): RunSetting[] {
  const facts = providerTaskFacts(task);
  const native = facts["Permission mode"];
  const permission = native && shortPermissionLabel(native);

  const reasoning =
    facts["Effective reasoning"] ?? (task.reasoning_effort || "default");

  // Named as the composer names it, when the provider still lists the model.
  const ran = facts["Effective model"] ?? task.model;
  const model = ran ? modelName(models, ran) : "Default model";

  return [
    { label: model, compact: model },
    {
      label:
        reasoning === "default" ? "Default reasoning" : titleCase(reasoning),
      compact: compactReasoningLabel(reasoning),
    },
    ...(permission
      ? [{ label: permission, compact: compactPermissionLabel(permission) }]
      : []),
  ];
}

/** What the task runs with, and what it asked for where that differs. */
function runSettingsTitle(task: Task, profile: string, settings: RunSetting[]) {
  const facts = providerTaskFacts(task);

  const requested = [
    facts["Requested permission mode"],
    facts["Effective model"] && task.model,
    facts["Effective reasoning"] &&
      `${titleCase(task.reasoning_effort ?? "")} reasoning`,
  ].filter(Boolean);

  return [
    `Set when the task started: ${[profile, ...settings.map((setting) => setting.label)].join(" · ")}`,
    ...(requested.length ? [`Requested: ${requested.join(", ")}`] : []),
  ].join(". ");
}

/**
 * The profile, model, reasoning and permission mode a task started with,
 * shown beside the composer. They are fixed for the task's later turns.
 * The profile shows as its icon and the rest abbreviate beside it, as the
 * new-task composer's summary reads them. The full labels remain for
 * assistive tech and the tooltip.
 */
export function TaskRunSettings({
  task,
  collapsed = false,
}: TaskRunSettingsProps) {
  const ref = useRef<HTMLUListElement>(null);
  const workers = useSnapshot((state) => state.workers);

  // Recheck changed labels on render and available space on resize.
  useLayoutEffect(() => {
    const element = ref.current;
    const row = element?.parentElement;
    if (!collapsed || !element || !row) return;

    const measure = () => {
      // Compare both layouts before paint so hidden settings can return on resize.
      element.hidden = true;
      const height = row.offsetHeight;
      element.hidden = false;
      element.hidden = row.offsetHeight > height;
    };

    measure();

    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);

    observer?.observe(row);
    observer?.observe(element);

    return () => {
      observer?.disconnect();
      element.hidden = false;
    };
  });

  const models =
    workers.find((worker) => worker.provider === task.provider)?.models ?? [];

  const profile = titleCase(task.worker_profile);
  const settings = runSettings(task, models);

  return (
    <ul
      ref={ref}
      className="task-run-settings"
      aria-label="Task settings"
      title={runSettingsTitle(task, profile, settings)}
    >
      <li>
        <WorkerProfileIcon profile={task.worker_profile} size={12} />
        <span className="visually-hidden">{profile}</span>
      </li>
      {settings.map(({ label, compact }) => (
        <li key={label} data-compact={compact ? undefined : "hidden"}>
          {compact === label ? (
            label
          ) : (
            <>
              <span className="visually-hidden">{label}</span>
              {compact && (
                <span className="task-run-setting-compact" aria-hidden="true">
                  {compact}
                </span>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
