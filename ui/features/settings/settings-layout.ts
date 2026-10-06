import type {
  HelpPart,
  ModelScope,
  SettingOption,
  SettingRow,
  SettingSection,
} from "../../../src/features/settings/settings-document";
import type { SettingValue } from "../../shared/state/types";

/** Form logic for the settings dialog: values in and out, summaries, resets. */

export type { HelpPart, ModelScope, SettingOption, SettingRow, SettingSection };

/** Form state keeps every value as a string. */
export type Values = Record<string, string>;

type Settings = Record<string, SettingValue>;

/** A budget row's on/off state lives beside its amount in the form. */
export const onKey = (key: string) => `${key}:on`;

/** The setting keys a row edits. */
export function rowKeys(row: SettingRow): string[] {
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
    default:
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

  for (const row of sections.flatMap((section) => section.rows))
    if (row.kind === "budget") {
      const on = onKey(row.key);
      if (edited(on)) set[row.toggle] = form[on] === "true";
      // A blank amount while off keeps the saved one.
      if (
        form[row.key] !== "" &&
        (edited(row.key) || (edited(on) && form[on] === "true"))
      )
        set[row.key] = Number(form[row.key]);
    } else
      for (const key of rowKeys(row))
        if (edited(key))
          set[key] = row.kind === "switch" ? form[key] === "true" : form[key];

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

const labelOf = (options: SettingOption[] | undefined, value: string) =>
  options?.find((option) => option.value === value)?.label ?? value;

/** Short value labels for a collapsed section's one-line summary. */
export function summary(row: SettingRow, form: Values): string[] {
  switch (row.kind) {
    case "models": {
      const overrides = row.scopes.flatMap((scope) => {
        const model = form[scope.model.key],
          effort = form[scope.effort.key];

        const parts = [
          model && labelOf(scope.model.options, model),
          effort !== "default" && `${effort} effort`,
        ].filter(Boolean);

        return parts.length ? [`${scope.label}: ${parts.join(", ")}`] : [];
      });

      return overrides.length ? overrides : ["All inherit"];
    }

    case "budget":
      return [
        form[onKey(row.key)] === "true"
          ? `${form[row.key]} ${row.unit}`
          : "No limit",
      ];
    case "switch":
      return [form[row.key] === "true" ? "On" : "Off"];
    default:
      return [labelOf(row.options, form[row.key])];
  }
}

/**
 * The open sections, or the first section when none of them exists in the
 * current layout. Closing every section on purpose is kept.
 */
export function openSections(open: string[], sections: SettingSection[]) {
  const ids = sections.map((section) => section.id);

  return !open.length || open.some((id) => ids.includes(id))
    ? open
    : ids.slice(0, 1);
}

export const helpId = (key: string) => `setting-${key}-help`;
