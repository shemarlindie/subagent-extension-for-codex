import type { ReactNode } from "react";

import { unsupportedEffortWarning } from "../../../shared/settings/settings-document";
import { SkeletonShape } from "../../shared/components/loading-skeleton/loading-skeleton";
import { FormSelect } from "../../shared/forms/form-select";
import {
  WorkerProfileIcon,
  workerProfileIconName,
} from "../tasks/list/worker-profile-icon";
import type { SettingsControls } from "./settings-fields";
import { fieldName, type ModelScope } from "./settings-layout";

interface ModelTableProps extends SettingsControls {
  scopes: ModelScope[];
  loading?: boolean;
  reserveProviderScope?: boolean;
}

/** Model and reasoning-effort defaults, one row per scope. */
export function ModelTable({
  scopes,
  control,
  register,
  loading = false,
  reserveProviderScope = false,
}: ModelTableProps) {
  return (
    <div className="model-table">
      <div className="model-table-head" aria-hidden="true">
        <span />
        <span>Model</span>
        <span>Reasoning effort</span>
      </div>
      {scopes.map((scope) => {
        const modelName = fieldName(scope.model.path),
          effortName = fieldName(scope.effort.path),
          warningId = `setting-${effortName}-warning`,
          hasProfileIcon = Boolean(workerProfileIconName(scope.id));

        // Without a discovered catalog the model ID is typed instead.
        let modelControl: ReactNode;

        if (loading) {
          modelControl = (
            <FormSelect
              control={control}
              name={modelName}
              id={`setting-${modelName}`}
              label={scope.model.label}
              options={scope.model.options ?? []}
              loading
              loadingLabel={`Loading ${scope.model.label.toLowerCase()}`}
              placeholder="Loading…"
            />
          );
        } else if (scope.model.options) {
          modelControl = (
            <FormSelect
              control={control}
              name={modelName}
              id={`setting-${modelName}`}
              label={scope.model.label}
              options={scope.model.options}
            />
          );
        } else {
          modelControl = (
            <input
              id={`setting-${modelName}`}
              type="text"
              placeholder="Inherit"
              maxLength={200}
              aria-label={scope.model.label}
              {...register(modelName)}
            />
          );
        }

        return (
          <div key={scope.id} className="model-table-row">
            <span
              className={`setting-label${hasProfileIcon ? " setting-profile-label" : ""}`}
            >
              {hasProfileIcon && (
                <WorkerProfileIcon
                  profile={scope.id}
                  size={10}
                  className="setting-profile-icon"
                />
              )}
              {scope.label}
            </span>
            {modelControl}
            <FormSelect
              control={control}
              name={effortName}
              id={`setting-${effortName}`}
              label={scope.effort.label}
              options={scope.effort.options}
              describedBy={scope.effort.unsupported ? warningId : undefined}
              disabled={loading}
              loading={loading}
              loadingLabel={`Loading ${scope.effort.label.toLowerCase()}`}
              placeholder={loading ? "Loading…" : undefined}
            />
            {scope.effort.unsupported && (
              <p id={warningId} className="help warn">
                {unsupportedEffortWarning}
              </p>
            )}
          </div>
        );
      })}
      {loading && reserveProviderScope && (
        <div className="model-table-row" aria-hidden="true">
          <SkeletonShape className="settings-model-loading-label" />
          <SkeletonShape className="settings-model-loading-control" />
          <SkeletonShape className="settings-model-loading-control" />
        </div>
      )}
    </div>
  );
}
