import { shortPermissionLabel } from "../../../../../shared/providers/claude/permissions";
import { providerTaskFacts } from "../../../../../shared/providers/presentation";
import type { ModelChoice } from "../../../../../shared/providers/types";
import { titleCase } from "../../../../../shared/text";
import { useSnapshot } from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { Icon } from "../../../../shared/components/icons/icons";
import { compactPermissionLabel } from "../../../delegation/permission-label";
import {
  compactReasoningLabel,
  modelName,
} from "../../../delegation/setting-labels";
import { workerProfileIconName } from "../../list/worker-profile-icon";

type TaskRunSettingsProps = { task: Task };

/** A setting's label, and the abbreviation shown for it; none leaves it unshown. */
type RunSetting = { label: string; compact?: string };

/** The settings a task started with, in the order they're shown. */
function runSettings(task: Task, models: readonly ModelChoice[]): RunSetting[] {
  const facts = providerTaskFacts(task),
    native = facts["Permission mode"],
    permission = native && shortPermissionLabel(native),
    reasoning = task.reasoning_effort || "default",
    profile = titleCase(task.worker_profile),
    // Named as the composer names it, when the provider still lists the model.
    ran = facts["Effective model"] ?? task.model,
    model = ran ? modelName(models, ran) : "Default model";

  return [
    { label: profile, compact: profile },
    { label: model, compact: model },
    {
      label: reasoning === "default" ? "Default effort" : titleCase(reasoning),
      compact: compactReasoningLabel(reasoning),
    },
    ...(permission
      ? [{ label: permission, compact: compactPermissionLabel(permission) }]
      : []),
  ];
}

/** What the task runs with, and what it asked for where that differs. */
function runSettingsTitle(task: Task, settings: RunSetting[]) {
  const facts = providerTaskFacts(task),
    requested = [
      facts["Requested permission mode"],
      facts["Effective model"] && task.model,
    ].filter(Boolean);

  return [
    `Set when the task started: ${settings.map((setting) => setting.label).join(" · ")}`,
    ...(requested.length ? [`Requested: ${requested.join(", ")}`] : []),
  ].join(". ");
}

/**
 * The profile, model, reasoning and permission mode a task started with,
 * shown beside the composer. They are fixed for the task's later turns.
 * The profile keeps a pill and the rest abbreviate beside it, as the
 * new-task composer's summary reads them; the full labels remain for
 * assistive tech and the tooltip.
 */
export function TaskRunSettings({ task }: TaskRunSettingsProps) {
  const { workers } = useSnapshot(),
    models =
      workers.find((worker) => worker.provider === task.provider)?.models ?? [],
    icon = workerProfileIconName(task.worker_profile),
    settings = runSettings(task, models);

  return (
    <ul
      className="task-run-settings"
      aria-label="Task settings"
      title={runSettingsTitle(task, settings)}
    >
      {settings.map(({ label, compact }, index) => (
        <li key={label} data-compact={compact ? undefined : "hidden"}>
          {index === 0 && icon && <Icon name={icon} size={10} />}
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
