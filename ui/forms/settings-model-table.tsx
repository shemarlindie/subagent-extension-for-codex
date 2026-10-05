import { unsupportedEffortWarning } from "../../src/core/settings-document";
import {
  WorkerProfileIcon,
  workerProfileIconName,
} from "../components/worker-profile-icon";
import { FormSelect } from "./form-select";
import type { SettingsControls } from "./settings-fields";
import type { ModelScope } from "./settings-layout";

interface ModelTableProps extends SettingsControls {
  scopes: ModelScope[];
}

/** Model and reasoning-effort defaults, one row per scope. */
export function ModelTable({ scopes, control, register }: ModelTableProps) {
  return (
    <div className="model-table">
      <div className="model-table-head" aria-hidden="true">
        <span />
        <span>Model</span>
        <span>Reasoning effort</span>
      </div>
      {scopes.map((scope) => {
        const warningId = `setting-${scope.effort.key}-warning`,
          profile = scope.model.key.replace(/_default_model$/, ""),
          hasProfileIcon = Boolean(workerProfileIconName(profile));

        return (
          <div key={scope.model.key} className="model-table-row">
            <span
              className={`setting-label${hasProfileIcon ? " setting-profile-label" : ""}`}
            >
              {hasProfileIcon && (
                <WorkerProfileIcon
                  profile={profile}
                  size={10}
                  className="setting-profile-icon"
                />
              )}
              {scope.label}
            </span>
            {/* Without a discovered catalog the model ID is typed instead. */}
            {scope.model.options ? (
              <FormSelect
                control={control}
                name={scope.model.key}
                id={`setting-${scope.model.key}`}
                label={scope.model.label}
                options={scope.model.options}
              />
            ) : (
              <input
                id={`setting-${scope.model.key}`}
                type="text"
                placeholder="Inherit"
                maxLength={200}
                aria-label={scope.model.label}
                {...register(scope.model.key)}
              />
            )}
            <FormSelect
              control={control}
              name={scope.effort.key}
              id={`setting-${scope.effort.key}`}
              label={scope.effort.label}
              options={scope.effort.options}
              describedBy={scope.effort.unsupported ? warningId : undefined}
            />
            {scope.effort.unsupported && (
              <p id={warningId} className="help warn">
                {unsupportedEffortWarning}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
