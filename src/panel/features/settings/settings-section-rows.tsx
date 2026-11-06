import type { SettingsSearch } from "./search/settings-search";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";
import { Help, SettingRowView, type SettingsControls } from "./settings-fields";
import { fieldName, type SettingSection } from "./settings-layout";
import { ModelTable } from "./settings-model-table";

interface SettingsSectionRowsProps extends SettingsControls {
  section: SettingSection;
  search: SettingsSearch;
}

/** Keep filtered fields mounted so their drafts and validation stay active. */
export function SettingsSectionRows({
  section,
  search,
  control,
  register,
}: SettingsSectionRowsProps) {
  const rows = section.rows.map((row) => {
    const scopes =
        row.kind === "models"
          ? row.scopes.map((scope) => ({
              scope,
              match: search.scopeMatch(section, scope),
            }))
          : [],
      match = row.kind === "models" ? undefined : search.rowMatch(section, row),
      score =
        row.kind === "models"
          ? Math.min(...scopes.map((entry) => entry.match?.score ?? Infinity))
          : (match?.score ?? Infinity);

    return { row, scopes, match, score };
  });

  if (search.active) rows.sort((a, b) => a.score - b.score);

  return (
    <>
      {section.help?.length ? (
        <div className="settings-section-intro">
          <Help id={`settings-${section.id}-help`} parts={section.help} />
        </div>
      ) : null}
      {section.facts?.length ? (
        <dl className="settings-facts">
          {section.facts.map(({ label, detail }) => (
            <div key={`${label}${detail}`} className="setting-row">
              <dt className="setting-label">
                <SettingsSearchHighlight text={label} />
              </dt>
              <dd className="help">
                <SettingsSearchHighlight text={detail} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {rows.map(({ row, scopes, match }) => {
        if (row.kind === "models") {
          const ordered = search.active
            ? scopes.toSorted(
                (a, b) =>
                  (a.match?.score ?? Infinity) - (b.match?.score ?? Infinity),
              )
            : scopes;

          return (
            <ModelTable
              key={row.scopes.map((scope) => scope.id).join(":")}
              scopes={ordered.map((entry) => entry.scope)}
              hiddenScopes={scopes
                .filter((entry) => !entry.match)
                .map((entry) => entry.scope.id)}
              expandedScopes={
                search.active
                  ? scopes
                      .filter((entry) => entry.match?.expandInstructions)
                      .map((entry) => entry.scope.id)
                  : []
              }
              searchNotes={Object.fromEntries(
                scopes.map((entry) => [
                  entry.scope.id,
                  entry.match?.explanation,
                ]),
              )}
              control={control}
              register={register}
            />
          );
        }

        const explanation = search.active ? match?.explanation : undefined,
          noteId = explanation
            ? `settings-match-${fieldName(row.path)}`
            : undefined;

        return (
          <div key={row.path} className="settings-search-row" hidden={!match}>
            <SettingRowView
              row={row}
              control={control}
              register={register}
              searchNoteId={noteId}
            />
            {explanation && (
              <p id={noteId} className="settings-search-note">
                <SettingsSearchHighlight text={explanation} />
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
