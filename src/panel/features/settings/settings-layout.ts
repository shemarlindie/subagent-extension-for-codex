import type {
  HelpPart,
  ModelScope,
  ProseSetting,
  SettingRow,
  SettingSection,
} from "../../../shared/settings/settings-document";
import {
  settingAt,
  withSetting,
} from "../../../shared/settings/settings-schema";
import { scalarText } from "../../../shared/text";

/** Form logic for the settings dialog: values in and out, summaries, resets. */

export type { HelpPart, ModelScope, ProseSetting, SettingRow, SettingSection };

/** Form state keeps every value as a string, keyed by `fieldName`. */
export type Values = Record<string, string>;

/**
 * A setting's form field and DOM ID part. Keys never contain `-`, so the form
 * stays flat and IDs need no CSS escaping: `task.worker_profile` is
 * `task-worker_profile`.
 */
export const fieldName = (path: string) => path.replaceAll(".", "-");

/** A budget row's on/off state and amount are settings under its path. */
const budgetPaths = (path: string) => ({
  enabled: `${path}.enabled`,
  amount: `${path}.amount`,
});

/**
 * A row's form field, and a budget's on/off switch. A budget's amount is its
 * field, and its switch sits beside it.
 */
export function rowFieldNames(row: Exclude<SettingRow, { kind: "models" }>) {
  if (row.kind !== "budget") return { name: fieldName(row.path) };

  const { enabled, amount } = budgetPaths(row.path);

  return { name: fieldName(amount), enabledName: fieldName(enabled) };
}

/** The setting paths a model scope edits. */
const scopePaths = (scope: ModelScope) => [
  scope.model.path,
  scope.effort.path,
  ...(scope.instructions ? [scope.instructions.path] : []),
];

/** The setting paths a row edits. */
function rowPaths(row: SettingRow): string[] {
  if (row.kind === "models") return row.scopes.flatMap(scopePaths);

  if (row.kind === "budget") {
    const { enabled, amount } = budgetPaths(row.path);

    return [enabled, amount];
  }

  return [row.path];
}

/** The settings a section edits, by path. */
export const sectionPaths = (section: SettingSection) =>
  section.rows.flatMap(rowPaths);

/** A row's form entries for the given nested setting values. */
export function rowForm(row: SettingRow, values: unknown): Values {
  const text = (path: string, fallback = "") =>
    scalarText(settingAt(values, path), fallback);

  switch (row.kind) {
    case "models":
      return Object.fromEntries(
        row.scopes.flatMap((scope) =>
          scopePaths(scope).map((path) => [
            fieldName(path),
            text(path, path === scope.effort.path ? "default" : ""),
          ]),
        ),
      );

    case "budget":
      return Object.fromEntries(
        rowPaths(row).map((path) => [fieldName(path), text(path)]),
      );

    case "switch":
      return {
        [fieldName(row.path)]: String(settingAt(values, row.path) === true),
      };
    case "select":
    case "text":
      return { [fieldName(row.path)]: text(row.path) };
  }
}

export const sectionsForm = (sections: SettingSection[], values: unknown) =>
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
 * The nested update for edited settings only. A blank budget amount keeps the
 * saved one, so turning a limit off or on never loses it.
 */
export function changes(
  sections: SettingSection[],
  form: Values,
  initial: Values,
) {
  let set: Record<string, unknown> = {};

  for (const row of sections.flatMap((section) => section.rows)) {
    for (const path of rowPaths(row)) {
      const name = fieldName(path);
      const value = form[name];

      if (value === undefined || value === initial[name]) continue;

      if (row.kind === "budget") {
        if (path.endsWith(".amount")) {
          if (value !== "") set = withSetting(set, path, Number(value));
        } else {
          set = withSetting(set, path, value === "true");
        }
      } else {
        set = withSetting(
          set,
          path,
          row.kind === "switch" ? value === "true" : value,
        );
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
      row.kind === "models" ? row.scopes.map(scopePaths) : [rowPaths(row)],
    )
    .filter((paths) =>
      paths.some((path) => form[fieldName(path)] !== initial[fieldName(path)]),
    ).length;
}

/** The selected section, or the first section when the saved choice is stale. */
export function activeSection(
  selection: string,
  sections: ReadonlyArray<Pick<SettingSection, "id">>,
): string | undefined {
  const ids = new Set(sections.map((section) => section.id));

  return (ids.has(selection) ? selection : undefined) ?? sections[0]?.id;
}

export const helpId = (path: string) => `setting-${fieldName(path)}-help`;
