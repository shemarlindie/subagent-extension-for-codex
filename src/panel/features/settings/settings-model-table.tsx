import { Collapsible } from "@base-ui/react/collapsible";
import { type ReactNode, useContext, useState } from "react";

import { unsupportedEffortWarning } from "../../../shared/settings/settings-document";
import { buttonClass } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { SkeletonShape } from "../../shared/components/loading-skeleton/loading-skeleton";
import { FormSelect } from "../../shared/forms/form-select";
import { descriptionIds } from "../../shared/utils/description-ids";
import {
  WorkerProfileIcon,
  workerProfileIconName,
} from "../tasks/list/worker-profile-icon";
import { SettingsSearchContext } from "./search/settings-search-context";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";
import { SettingsContext, type SettingsControls } from "./settings-fields";
import { fieldName, type ModelScope } from "./settings-layout";
import { ProfileInstructions } from "./settings-profile-instructions";

interface SearchExpansion {
  query: string;
  opened: Record<string, boolean>;
}

interface ModelTableProps extends SettingsControls {
  scopes: ModelScope[];
  hiddenScopes?: string[];
  expandedScopes?: string[];
  searchNotes?: Record<string, string | undefined>;
  loading?: boolean;
  reserveProviderScope?: boolean;
}

/**
 * Model and reasoning-effort defaults, one row per scope. A worker profile's
 * instructions sit collapsed under its row until its name opens them. A dot
 * at the far end of the name marks instructions that are set.
 */
export function ModelTable({
  scopes,
  control,
  register,
  hiddenScopes = [],
  expandedScopes = [],
  searchNotes = {},
  loading = false,
  reserveProviderScope = false,
}: ModelTableProps) {
  const { form } = useContext(SettingsContext);
  const search = useContext(SettingsSearchContext);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const query = search.active ? search.terms.join(" ") : "";

  const [searchExpansion, setSearchExpansion] = useState<SearchExpansion>({
    query,
    opened: {},
  });

  // Search expansion is temporary. A fresh query starts from its match metadata.
  if (searchExpansion.query !== query) {
    setSearchExpansion({ query, opened: {} });
  }

  return (
    <div className="model-table">
      <div className="model-table-head" aria-hidden="true">
        <span />
        <span>Model</span>
        <span>Reasoning</span>
      </div>
      {scopes.map((scope) => {
        const modelName = fieldName(scope.model.path);
        const effortName = fieldName(scope.effort.path);
        const warningId = `setting-${effortName}-warning`;
        const note = searchNotes[scope.id];
        const noteId = note ? `settings-match-${modelName}` : undefined;
        const hasProfileIcon = Boolean(workerProfileIconName(scope.id));

        const onOpenChange = (open: boolean) => {
          if (search.active) {
            setSearchExpansion((current) => ({
              query,
              opened: { ...current.opened, [scope.id]: open },
            }));
          } else {
            setOpened((current) => ({ ...current, [scope.id]: open }));
          }
        };

        // Without a discovered catalog the model ID is typed instead.
        let modelControl: ReactNode;

        if (loading) {
          modelControl = (
            <FormSelect
              control={control}
              name={modelName}
              id={`setting-${modelName}`}
              label={scope.model.label}
              describedBy={noteId}
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
              describedBy={noteId}
              options={scope.model.options}
              footer={scope.model.footer}
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
              aria-describedby={noteId}
              {...register(modelName)}
            />
          );
        }

        const name = (
          <>
            {hasProfileIcon && (
              <WorkerProfileIcon
                profile={scope.id}
                size={12}
                className="setting-profile-icon"
              />
            )}
            <SettingsSearchHighlight text={scope.label} />
          </>
        );

        const labelClass = `setting-label${hasProfileIcon ? " setting-profile-label" : ""}`;

        const controls = (
          <>
            {modelControl}
            <FormSelect
              control={control}
              name={effortName}
              id={`setting-${effortName}`}
              label={scope.effort.label}
              options={scope.effort.options}
              describedBy={descriptionIds(
                noteId,
                scope.effort.unsupported ? warningId : undefined,
              )}
              disabled={loading}
              loading={loading}
              loadingLabel={`Loading ${scope.effort.label.toLowerCase()}`}
              placeholder={loading ? "Loading…" : undefined}
            />
            {note && (
              <p id={noteId} className="settings-search-note">
                <SettingsSearchHighlight text={note} />
              </p>
            )}
            {[scope.model.warning, scope.effort.warning].map(
              (warning) =>
                warning && (
                  <p key={warning} className="help warn">
                    {warning}
                  </p>
                ),
            )}
            {scope.effort.unsupported && (
              <p id={warningId} className="help warn">
                {unsupportedEffortWarning}
              </p>
            )}
          </>
        );

        return scope.instructions ? (
          <Collapsible.Root
            key={scope.id}
            className="model-table-row"
            hidden={hiddenScopes.includes(scope.id)}
            disabled={loading}
            open={
              search.active
                ? (searchExpansion.opened[scope.id] ??
                  expandedScopes.includes(scope.id))
                : (opened[scope.id] ?? false)
            }
            onOpenChange={onOpenChange}
          >
            <Collapsible.Trigger
              className={buttonClass("ghost", {
                className: `${labelClass} profile-instructions-trigger`,
              })}
              aria-label={scope.instructions.label}
              aria-describedby={noteId}
            >
              {name}
              {form[fieldName(scope.instructions.path)]?.trim() && (
                <Icon
                  name="dot"
                  size={10}
                  className="profile-instructions-set"
                  label="Has custom instructions"
                />
              )}
            </Collapsible.Trigger>
            {controls}
            <ProfileInstructions
              setting={scope.instructions}
              describedBy={noteId}
              register={register}
            />
          </Collapsible.Root>
        ) : (
          <div
            key={scope.id}
            className="model-table-row"
            hidden={hiddenScopes.includes(scope.id)}
          >
            <span className={labelClass}>{name}</span>
            {controls}
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
