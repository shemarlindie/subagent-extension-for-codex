import type {
  HelpPart,
  ModelScope,
  SettingRow,
  SettingSection,
} from "../../../shared/settings/settings-document";
import type { SettingValue } from "../../app/state/types";

/** Form logic for the settings dialog: values in and out, summaries, resets. */

export type { HelpPart, ModelScope, SettingRow, SettingSection };

/** Form state keeps every value as a string. */
export type Values = Record<string, string>;

type Settings = Partial<Record<string, SettingValue>>;

/** A budget row's on/off state lives beside its amount in the form. */
export const onKey = (key: string) => `${key}:on`;

/** The setting keys a row edits. */
function rowKeys(row: SettingRow): string[] {
  return row.kind === "models"
    ? row.scopes.flatMap((scope) => [scope.model.key, scope.effort.key])
    : [row.key];
}

export const sectionKeys = (section: SettingSection) =>
  section.rows.flatMap(rowKeys);

/** A row's form entries for the given setting values. */
export function rowForm(row: SettingRow, values: Settings): Values {
  switch (row.kind) {
    case "models":
      return Object.fromEntries(
        row.scopes.flatMap((scope) => [
          [scope.model.key, String(values[scope.model.key] ?? "")],
          [scope.effort.key, String(values[scope.effort.key] ?? "default")],
        ]),
      );

    // A limit that is off still shows the amount it would restore.
    case "budget": {
      const value = values[row.key];

      return {
        [row.key]: String(value ?? row.amount),
        [onKey(row.key)]: String(value !== null && value !== undefined),
      };
    }

    case "switch":
      return { [row.key]: String(values[row.key] === true) };
    case "select":
    case "text":
      return { [row.key]: String(values[row.key] ?? "") };
  }
}

export const sectionsForm = (sections: SettingSection[], values: Settings) =>
  Object.assign(
    {},
    ...sections.flatMap((section) =>
      section.rows.map((row) => rowForm(row, values)),
    ),
  ) as Values;

/** Whether any of the given form entries differ from `form`. */
export const differs = (entries: Values, form: Values) =>
  Object.entries(entries).some(([key, value]) => form[key] !== value);

/**
 * The update for edited rows only. Budgets send their on/off switch and
 * amount, so turning a limit off keeps its amount for later.
 */
export function changes(
  sections: SettingSection[],
  form: Values,
  initial: Values,
) {
  const set: Record<string, unknown> = {};
  const edited = (key: string) => form[key] !== initial[key];

  for (const row of sections.flatMap((section) => section.rows)) {
    if (row.kind === "budget") {
      const on = onKey(row.key);
      if (edited(on)) set[row.toggle] = form[on] === "true";

      // A blank amount while off keeps the saved one.
      if (
        form[row.key] !== "" &&
        (edited(row.key) || (edited(on) && form[on] === "true"))
      ) {
        set[row.key] = Number(form[row.key]);
      }
    } else {
      for (const key of rowKeys(row)) {
        if (edited(key)) {
          set[key] = row.kind === "switch" ? form[key] === "true" : form[key];
        }
      }
    }
  }

  return set;
}

/** How many of a section's rows or model scopes have unsaved edits. */
export function editCount(
  section: SettingSection,
  form: Values,
  initial: Values,
) {
  return section.rows
    .flatMap((row) =>
      row.kind === "models"
        ? row.scopes.map((scope) => [scope.model.key, scope.effort.key])
        : [Object.keys(rowForm(row, {}))],
    )
    .filter((keys) => keys.some((key) => form[key] !== initial[key])).length;
}

/** The selected section, or the first section when the saved choice is stale. */
export function activeSection(
  selection: string,
  sections: ReadonlyArray<Pick<SettingSection, "id">>,
): string | undefined {
  const ids = new Set(sections.map((section) => section.id));

  return (ids.has(selection) ? selection : undefined) ?? sections[0]?.id;
}

export const helpId = (key: string) => `setting-${key}-help`;
