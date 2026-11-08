import { Fragment, type ReactNode, useEffect, useState } from "react";

import type { AboutInfo } from "../../../shared/about/types";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { CopyButton } from "../../shared/components/copy-button/copy-button";
import { Icon } from "../../shared/components/icons/icons";
import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../shared/components/loading-skeleton/loading-skeleton";
import { errorMessage } from "../../shared/utils/error-message";
import { formatUserDateTime } from "../../shared/utils/user-date-time";
import type { settingsSearch } from "./search/settings-search";
import { SettingsClaudeVersion } from "./settings-claude-version";
import type { SettingsSectionView } from "./settings-sections";

export function aboutSection(
  search: ReturnType<typeof settingsSearch>,
  selected: string | undefined,
  ready: boolean,
): SettingsSectionView {
  const matches = search.matches(
    "About extension version installation build commit local GitHub npm Claude Code CLI Agent SDK MCP Node platform runtime diagnostics update upgrade Homebrew native recheck",
  );

  return {
    id: "about",
    title: "About",
    hidden: !matches,
    matches: matches ? 1 : 0,
    score: 3,
    content:
      ready && (selected === "about" || (search.active && matches)) ? (
        <SettingsAbout />
      ) : null,
  };
}

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

/** Read only diagnostics, loaded only while the About section is visible. */
function SettingsAbout() {
  const controller = useController(),
    { host } = useSnapshot(),
    [info, setInfo] = useState<AboutInfo>(),
    [error, setError] = useState<string>(),
    [pending, setPending] = useState(true),
    [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;

    controller.tool<AboutInfo>("app_get_about", { refresh: attempt > 0 }).then(
      (result) => {
        if (current) {
          setInfo(result);
          setPending(false);
        }
      },
      (reason: unknown) => {
        if (current) {
          setError(errorMessage(reason));
          setPending(false);
        }
      },
    );

    return () => {
      current = false;
    };
  }, [controller, attempt]);

  function retry() {
    setError(undefined);
    setPending(true);
    setAttempt((value) => value + 1);
  }

  if (error && !info) {
    return (
      <div className="settings-about">
        <p className="form-error" role="alert">
          {error}
        </p>
        <Button onClick={retry}>Retry</Button>
      </div>
    );
  }

  if (!info) {
    return (
      <LoadingSkeleton
        label="Loading version details"
        className="settings-about"
      >
        <div className="settings-about-product">
          <SkeletonShape measureText="Subagent Extension for Codex" />
        </div>
        {["Extension", "Claude", "SDKs", "Service runtime"].map((title) => (
          <div className="settings-about-group" key={title}>
            <h3>{title}</h3>
            <dl>
              {["Version", "Runtime", "Details"].map((row) => (
                <div key={row}>
                  <dt>
                    <SkeletonShape measureText={row} />
                  </dt>
                  <dd>
                    <SkeletonShape measureText="0.0.000" />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </LoadingSkeleton>
    );
  }

  const { build, claude, runtime } = info,
    checkout = info.installation === "checkout",
    cliStatus = claude && (claude.ready ? "Ready" : "Needs attention"),
    cliVersion = claude?.details.version ?? "Unavailable",
    sections: AboutSection[] = [
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
                onRecheck={retry}
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
        ],
      },
    ],
    diagnostics = aboutDiagnostics(sections, claude?.message);

  return (
    <div className="settings-about">
      <div className="settings-about-product">
        <span className="settings-about-mark">
          <Icon name="quiet-constellation" size={28} />
        </span>
        <div>
          <h3>Subagent Extension for Codex</h3>
          <p className="muted">Delegate to Claude without leaving Codex.</p>
        </div>
      </div>
      {sections.map(({ title, rows }) => (
        <section
          className="settings-about-group"
          key={title}
          aria-label={title}
        >
          <h3>{title}</h3>
          <dl>
            {rows.map(({ label, value, element }) => (
              <Fragment key={label}>
                {element ?? (
                  <div>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                )}
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
      <div className="settings-about-diagnostics">
        <CopyButton text={diagnostics} label="Copy diagnostics" />
        <p className="muted">
          Version and runtime details for bug reports. Includes the CLI path
          when available.
        </p>
      </div>
    </div>
  );
}
