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
  Claude: {
    "Claude Code CLI": ["version", "update", "upgrade", "recheck"],
    "CLI status": ["ready", "readiness"],
    Installation: ["Homebrew", "native", "npm", "update", "upgrade"],
    Executable: ["path", "binary"],
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

const rowText = (group: string, label: string) =>
  ["About", group, label, ...(ABOUT_ROW_KEYWORDS[group]?.[label] ?? [])].join(
    " ",
  );

// An empty search matches everything.
export const aboutRowMatches = (
  search: SettingsSearch,
  group: string,
  label: string,
) => search.matches(rowText(group, label));

export const aboutDiagnosticsMatch = (search: SettingsSearch) =>
  search.matches(`About ${DIAGNOSTICS_KEYWORDS}`);

/** Counts matching rows, including ones only some installations show. */
export function aboutSearchMatches(search: SettingsSearch) {
  const rows = Object.entries(ABOUT_ROW_KEYWORDS).flatMap(([group, labels]) =>
    Object.keys(labels).filter((label) =>
      aboutRowMatches(search, group, label),
    ),
  );

  return rows.length + (aboutDiagnosticsMatch(search) ? 1 : 0);
}
