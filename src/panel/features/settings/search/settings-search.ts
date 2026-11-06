import type {
  HelpPart,
  ModelScope,
  SettingRow,
  SettingSection,
} from "../settings-layout";

const helpText = (help: HelpPart[] = []) =>
  help.map((part) => (typeof part === "string" ? part : part.text)).join("");

const normalize = (text: string) => text.toLowerCase().trim();

const searchable = (text: string) =>
  `${normalize(text)} ${normalize(text).replace(/[._-]+/g, " ")}`;

type SearchableField = {
  path: string;
  label: string;
  help?: HelpPart[];
  keywords?: string[];
  options?: { value: string; label: string; description?: string }[];
};

export interface SettingsSearchMatch {
  /** Smaller scores put direct matches ahead of incidental matches. */
  score: number;
  explanation?: string;
  expandInstructions?: boolean;
}

/** Search stable metadata, so editing values cannot change the result set. */
export function settingsSearch(query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean),
    matches = (text: string) =>
      terms.every((term) => searchable(text).includes(term));

  const fieldMatch = (
    section: SettingSection,
    fields: SearchableField[],
    label: string,
  ): SettingsSearchMatch | undefined => {
    const labels = [label, ...fields.map((field) => field.label)].join(" "),
      paths = fields.map((field) => field.path).join(" "),
      help = fields.map((field) => helpText(field.help)).join(" "),
      options = fields.flatMap((field) => field.options ?? []),
      keywords = fields.flatMap((field) => field.keywords ?? []),
      context = `${section.title} ${helpText(section.help)}`;

    if (
      !matches(
        [
          labels,
          paths,
          help,
          context,
          ...keywords,
          ...options.flatMap((option) => [
            option.label,
            option.value,
            option.description ?? "",
          ]),
        ].join(" "),
      )
    ) {
      return;
    }

    if (matches(labels)) return { score: 0 };

    if (matches(paths)) {
      return {
        score: 0,
        explanation: `Setting: ${fields.find((field) => matches(field.path))?.path ?? paths}`,
      };
    }

    if (matches(`${labels} ${paths} ${help}`)) return { score: 1 };

    const option = options.find((option) =>
      matches(
        `${labels} ${option.label} ${option.value} ${option.description ?? ""}`,
      ),
    );

    if (option) {
      const detail =
        option.description &&
        !matches(`${labels} ${option.label} ${option.value}`)
          ? `: ${option.description}`
          : "";

      return { score: 2, explanation: `Includes ${option.label}${detail}` };
    }

    const alias = keywords.find((keyword) =>
      terms.some((term) => searchable(keyword).includes(term)),
    );

    if (alias) return { score: 2, explanation: `Related to ${alias}` };
    if (matches(context)) return { score: 3 };

    return { score: 2, explanation: `In ${section.title}` };
  };

  const scopeMatch = (section: SettingSection, scope: ModelScope) => {
    const result = fieldMatch(
      section,
      [
        scope.model,
        scope.effort,
        ...(scope.instructions ? [scope.instructions] : []),
      ],
      scope.label,
    );

    if (!result) return;

    return {
      ...result,
      expandInstructions: Boolean(
        terms.length &&
        scope.instructions &&
        terms.some(
          (term) =>
            searchable(
              `${scope.instructions?.path} ${scope.instructions?.label} ${helpText(scope.instructions?.help)}`,
            ).includes(term) &&
            !searchable(
              `${scope.label} ${scope.model.path} ${scope.model.label} ${scope.effort.path} ${scope.effort.label}`,
            ).includes(term),
        ),
      ),
    };
  };

  const rowMatch = (
    section: SettingSection,
    row: Exclude<SettingRow, { kind: "models" }>,
  ) =>
    fieldMatch(
      section,
      row.kind === "budget"
        ? [
            row,
            { path: `${row.path}.enabled`, label: row.label },
            { path: `${row.path}.amount`, label: row.label },
          ]
        : [row],
      row.label,
    );

  // Read-only facts have no setting path, and the section counts as one result.
  const factsMatch = (
    section: SettingSection,
    facts: NonNullable<SettingSection["facts"]>,
  ) =>
    fieldMatch(
      section,
      facts.map(({ label, detail }) => ({ path: "", label, help: [detail] })),
      section.title,
    );

  const sectionMatches = (section: SettingSection) =>
    [
      ...(section.facts ? [factsMatch(section, section.facts)] : []),
      ...section.rows.flatMap((row) =>
        row.kind === "models"
          ? row.scopes.map((scope) => scopeMatch(section, scope))
          : [rowMatch(section, row)],
      ),
    ].filter((match) => match !== undefined);

  return {
    active: terms.length > 0,
    terms,
    matches,
    rowMatch,
    scopeMatch,
    sectionMatches,
  };
}

export type SettingsSearch = ReturnType<typeof settingsSearch>;
