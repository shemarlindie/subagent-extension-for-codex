import { Fragment, type ReactNode, useContext } from "react";

import type { AboutInfo } from "../../../shared/about/types";
import { useSnapshot } from "../../app/state/controller-context";
import { CopyButton } from "../../shared/components/copy-button/copy-button";
import { formatUserDateTime } from "../../shared/utils/user-date-time";
import { SettingsSearchContext } from "./search/settings-search-context";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";
import {
  aboutDiagnosticsMatch,
  aboutRowMatches,
} from "./settings-about-search";
import { SettingsClaudeVersion } from "./settings-claude-version";
import { SettingsDataDirectory } from "./settings-data-directory";

function workingTree(dirty?: boolean) {
  if (dirty === undefined) return "Unknown";

  return dirty ? "Uncommitted changes" : "Clean";
}

const SDK_LABELS: Record<string, string> = {
  "@anthropic-ai/claude-agent-sdk": "Claude Agent SDK",
  "@modelcontextprotocol/sdk": "MCP SDK",
  "@modelcontextprotocol/ext-apps": "MCP Apps SDK",
};

/** `copy` replaces the displayed value in copied diagnostics. `element` replaces the row markup. */
type AboutRow = {
  label: string;
  value: string;
  copy?: string;
  element?: ReactNode;
};

type AboutSection = { title: string; rows: AboutRow[] };

function aboutDiagnostics(sections: AboutSection[], readinessMessage?: string) {
  return [
    "Subagent Extension for Codex",
    ...sections.map(
      ({ title, rows }) =>
        `\n${title}\n${rows.map(({ label, value, copy }) => `${label}: ${copy ?? value}`).join("\n")}`,
    ),
    ...(readinessMessage ? [`\nClaude readiness: ${readinessMessage}`] : []),
  ].join("\n");
}

type SettingsAboutContentProps = {
  info: AboutInfo;
  pending: boolean;
  error?: string;
  onRecheck: () => void;
};

/** The loaded About details, filtered to the rows a settings search matches. */
export function SettingsAboutContent({
  info,
  pending,
  error,
  onRecheck,
}: SettingsAboutContentProps) {
  const host = useSnapshot((state) => state.host);
  const search = useContext(SettingsSearchContext);
  const { build, claude, runtime } = info;
  const checkout = info.installation === "checkout";
  const cliStatus = claude && (claude.ready ? "Ready" : "Needs attention");
  const cliVersion = claude?.details.version ?? "Unavailable";

  const sections: AboutSection[] = [
    {
      title: "Extension",
      rows: [
        { label: "Version", value: build.version },
        {
          label: "Built at",
          value: build.built_at
            ? formatUserDateTime(build.built_at, host)
            : "Not recorded",
          copy: build.built_at,
        },
        {
          label: "Installation",
          value: checkout
            ? "Local checkout"
            : "Packaged release (GitHub / npm)",
        },
        ...(checkout
          ? [
              {
                label: "Commit",
                value: build.commit ?? "Unavailable",
              },
              {
                label: "Working tree snapshot",
                value: workingTree(build.dirty),
              },
            ]
          : []),
      ],
    },
    {
      title: "Claude",
      rows: [
        {
          label: "Claude Code CLI",
          value: cliVersion,
          element: (
            <SettingsClaudeVersion
              version={cliVersion}
              readiness={claude}
              recommended={info.claude_recommended}
              upgrade={info.claude_upgrade}
              pending={pending}
              error={error}
              onRecheck={onRecheck}
            />
          ),
        },
        { label: "CLI status", value: cliStatus ?? "Provider disabled" },
        ...(info.claude_upgrade
          ? [
              {
                label: "Installation",
                value: info.claude_upgrade.installation,
              },
            ]
          : []),
        ...(claude?.details.executable
          ? [
              {
                label: "Executable",
                value: claude.details.executable,
              },
            ]
          : []),
      ],
    },
    {
      title: "SDKs",
      rows: build.sdks.map(({ name, version }) => ({
        label: SDK_LABELS[name] ?? name,
        value: version,
      })),
    },
    {
      title: "Service runtime",
      rows: [
        { label: "Node.js", value: runtime.node },
        { label: "Platform", value: `${runtime.platform} · ${runtime.arch}` },
        {
          label: "Started by",
          value:
            runtime.launcher === "stdio"
              ? "Codex plugin"
              : "Foreground process",
        },
        {
          label: "Data directory",
          value: runtime.data_directory,
          element: (
            <SettingsDataDirectory
              path={runtime.data_directory}
              platform={runtime.platform}
            />
          ),
        },
      ],
    },
  ];

  // Diagnostics always copy every row, whatever search shows.
  const diagnostics = aboutDiagnostics(sections, claude?.message);

  const visibleSections = sections
    .map(({ title, rows }) => ({
      title,
      rows: rows.filter(({ label }) => aboutRowMatches(search, title, label)),
    }))
    .filter(({ rows }) => rows.length);

  const showDiagnostics = aboutDiagnosticsMatch(search);

  return (
    <div className="settings-about-body">
      {visibleSections.map(({ title, rows }) => (
        <section
          className="settings-about-group"
          key={title}
          aria-label={title}
        >
          <h3>
            <SettingsSearchHighlight text={title} />
          </h3>
          <dl>
            {rows.map(({ label, value, element }) => (
              <Fragment key={label}>
                {element ?? (
                  <div>
                    <dt>
                      <SettingsSearchHighlight text={label} />
                    </dt>
                    <dd>{value}</dd>
                  </div>
                )}
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
      {showDiagnostics && (
        <div className="settings-about-diagnostics">
          <CopyButton text={diagnostics} label="Copy diagnostics" />
          <p className="muted">
            Version and runtime details for bug reports. Includes the data
            directory and, when available, the CLI path.
          </p>
        </div>
      )}
      {!visibleSections.length && !showDiagnostics && (
        <p className="muted">No matching details on this installation.</p>
      )}
    </div>
  );
}
