import type { SettingsSearch } from "./search/settings-search";

/**
 * Search terms for each About row, by group and row label. Search matches this
 * stable metadata, so displayed values such as version numbers never match.
 */
const ABOUT_ROW_KEYWORDS: Record<string, Record<string, string[]>> = {
  Extension: {
    Version: ["release"],
    "Built at": ["build", "date"],
    Installation: ["local", "checkout", "packaged", "GitHub", "npm"],
    Commit: ["git", "build"],
    "Working tree snapshot": ["git", "dirty", "uncommitted"],
  },
  SDKs: {
    "Claude Agent SDK": ["version"],
    "MCP SDK": ["version"],
    "MCP Apps SDK": ["version"],
  },
  "Service runtime": {
    "Node.js": ["version"],
    Platform: ["OS", "arch"],
    "Started by": ["launcher", "plugin", "process"],
    "Data directory": ["folder", "storage", "path"],
  },
};

const DIAGNOSTICS_KEYWORDS = "diagnostics copy bug report";

const CLI_KEYWORDS: Record<string, string[]> = {
  "CLI status": ["ready", "readiness"],
  Installation: ["Homebrew", "native", "npm", "update", "upgrade"],
  Executable: ["path", "binary"],
};

function rowText(group: string, label: string) {
  const keywords = ABOUT_ROW_KEYWORDS[group];

  const cliTerms = label.endsWith(" CLI")
    ? ["version", "update", "upgrade", "recheck"]
    : CLI_KEYWORDS[label];

  const terms = keywords ? keywords[label] : cliTerms;

  return ["About", group, label, ...(terms ?? [])].join(" ");
}

// An empty search matches everything.
export const aboutRowMatches = (
  search: SettingsSearch,
  group: string,
  label: string,
) => search.matches(rowText(group, label));

export const aboutDiagnosticsMatch = (search: SettingsSearch) =>
  search.matches(`About ${DIAGNOSTICS_KEYWORDS}`);

/** Counts matching rows, including ones only some installations show. */
export function aboutSearchMatches(
  search: SettingsSearch,
  providers: { displayName: string; cliName: string }[],
) {
  const rows = [
    ...Object.entries(ABOUT_ROW_KEYWORDS).map(
      ([group, labels]) => [group, Object.keys(labels)] as const,
    ),
    ...providers.map(
      ({ displayName, cliName }) =>
        [
          displayName,
          [`${cliName} CLI`, ...Object.keys(CLI_KEYWORDS)],
        ] as const,
    ),
  ].flatMap(([group, labels]) =>
    labels.filter((label) => aboutRowMatches(search, group, label)),
  );

  return rows.length + (aboutDiagnosticsMatch(search) ? 1 : 0);
}
