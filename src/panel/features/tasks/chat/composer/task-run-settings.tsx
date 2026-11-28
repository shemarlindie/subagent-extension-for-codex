import { providerMetadata } from "../../../../../core/shared/providers/metadata";
import {
  flexibleModel,
  modelName,
} from "../../../../../core/shared/providers/policy";
import { providerTaskFacts } from "../../../../../core/shared/providers/presentation";
import { titleCase } from "../../../../../core/shared/text";
import { useSnapshot } from "../../../../app/state/controller-context";
import type { Task, Worker } from "../../../../app/state/types";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { compactPermissionLabel } from "../../../delegation/permission-label";
import { compactReasoningLabel } from "../../../delegation/setting-labels";
import { WorkerProfileIcon } from "../../list/worker-profile-icon";
import { ContextUsageMeter } from "./context-usage-meter";
import { PromptCacheTimer } from "./prompt-cache-timer";

type TaskRunSettingsProps = { task: Task };

/**
 * A setting's name in the tooltip, its label and the abbreviation shown for
 * it. Without an abbreviation, it stays unshown.
 */
type RunSetting = { name: string; label: string; compact?: string };

/** The settings shown after the profile, in order. */
function runSettings(task: Task, worker: Worker | undefined): RunSetting[] {
  const facts = providerTaskFacts(task);
  const native = facts["Permission mode"];

  const permission =
    providerMetadata(
      task.provider,
      worker?.metadata,
    )?.nativePermissions?.options.find(({ label }) => label === native)
      ?.shortLabel ?? native;

  const reasoning =
    facts["Effective reasoning"] ?? (task.reasoning_effort || "default");

  // Named as the composer names it, when the provider still lists the model.
  const ran = facts["Effective model"] ?? task.model;
  const model = ran ? modelName(worker?.models ?? [], ran) : "Default model";

  return [
    { name: "Model", label: model, compact: model },
    {
      name: "Reasoning",
      label:
        reasoning === "default" ? "Default reasoning" : titleCase(reasoning),
      compact: compactReasoningLabel(reasoning),
    },
    ...(permission
      ? [
          {
            name: "Permissions",
            label: permission,
            compact: compactPermissionLabel(permission),
          },
        ]
      : []),
  ];
}

/**
 * What the task explicitly asked for where it differs from what it runs with.
 * A Default choice records what it ran without asking for it.
 */
function requestedSettings(task: Task) {
  const facts = providerTaskFacts(task);
  const effort = task.reasoning_effort;

  const requested = [
    facts["Requested permission mode"],
    facts["Effective model"] && !flexibleModel(task.model) && task.model,
    facts["Effective reasoning"] &&
      effort &&
      effort !== "default" &&
      `${titleCase(effort)} reasoning`,
  ].filter(Boolean);

  return requested.length ? `Requested: ${requested.join(", ")}` : undefined;
}

/**
 * The profile, model, reasoning and permission mode a task started with,
 * shown beside the composer after the prompt cache timer and context usage
 * meter. They are fixed for the task's later turns.
 * The profile shows as its icon and the rest abbreviate beside it, as the
 * new-task composer's summary reads them. The full labels remain for
 * assistive tech and the tooltip.
 */
export function TaskRunSettings({ task }: TaskRunSettingsProps) {
  const workers = useSnapshot((state) => state.workers);

  const worker = workers.find((item) => item.provider === task.provider);

  const profile = titleCase(task.worker_profile);
  const settings = runSettings(task, worker);

  const started = [profile, ...settings.map((setting) => setting.label)].join(
    " · ",
  );

  const requested = requestedSettings(task);

  return (
    <ul className="task-run-settings" aria-label="Task settings">
      <PromptCacheTimer task={task} />
      <ContextUsageMeter task={task} />
      {/* One item, so the whole summary opens its tooltip. */}
      <TooltipWrapper
        label={[`Set when the task started: ${started}`, requested]
          .filter(Boolean)
          .join(". ")}
        content={
          <>
            <span className="run-setting-tooltip-status">
              Set when the task started
            </span>
            <span className="run-setting-tooltip-rows">
              {[{ name: "Profile", label: profile }, ...settings].map(
                ({ name, label }) => (
                  <span key={name}>
                    <span>{name}</span>
                    <span>{label}</span>
                  </span>
                ),
              )}
            </span>
            {requested && (
              <span className="run-setting-tooltip-note">{requested}</span>
            )}
          </>
        }
      >
        <li className="task-run-summary run-setting-trigger" tabIndex={0}>
          <span className="task-run-profile">
            <WorkerProfileIcon profile={task.worker_profile} />
            <span className="visually-hidden">{profile}</span>
          </span>
          {settings.map(({ label, compact }) => (
            <span
              key={label}
              className="task-run-setting"
              data-compact={compact ? undefined : "hidden"}
            >
              {compact === label ? (
                label
              ) : (
                <>
                  <span className="visually-hidden">{label}</span>
                  {compact && (
                    <span
                      className="task-run-setting-compact"
                      aria-hidden="true"
                    >
                      {compact}
                    </span>
                  )}
                </>
              )}
            </span>
          ))}
        </li>
      </TooltipWrapper>
    </ul>
  );
}
