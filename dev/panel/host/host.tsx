// Mock MCP Apps host for panel development. It embeds the panel the way Codex
// does (iframe + AppBridge), so the panel runs its real HostTransport, and
// answers tool calls from fixtures or the running service over MCP.
import "./host.css";

import {
  AppBridge,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type { UiStatePersistence } from "../../../src/panel/app/state/types";
import { browserUiState } from "../../../src/panel/app/view-state";
import {
  Icon,
  type IconName,
  ICONS,
} from "../../../src/panel/shared/components/icons/icons";
import type { Task } from "../../../src/shared/tasks/model";
import { PREVIEW_THREAD } from "../scenarios/fixtures";
import { previewTool } from "../scenarios/tools";
import {
  codexMeta,
  FIXTURE_SERVICE_TOOLS,
  fixtureCall,
  fixtureLaunchArgs,
  fixtureServiceCall,
  hasProjectEdits,
  normalizeCwd,
  parseStyles,
  removeFixtureProject,
  type Settings,
  settingsFrom,
  type Thread,
  threadLabel,
  threadsOf,
} from "./host-helpers";

type LogEntry = { id: number; time: string; kind: string; detail: unknown };

type InspectorTab = "bridge-log" | "host-settings" | "icon-catalog";

type DevHostWindow = Window & {
  __CODEX_SUBAGENT_DEV_UI_STATE__?: UiStatePersistence;
};

const inspectorTabs: { id: InspectorTab; label: string }[] = [
  { id: "bridge-log", label: "Bridge log" },
  { id: "host-settings", label: "Host settings" },
  { id: "icon-catalog", label: "Icon catalog" },
];

const iconNames = Object.keys(ICONS) as IconName[];

const storageKey = "panel-dev-host";
const fixtureReadDelayMs = 1200;

// Keep mutations out of this list so the inspection toggle never delays writes.
const fixtureReadTools = new Set([
  "get_agent_panel_context",
  "get_agent_settings",
  "get_user_agent_activity",
  "get_user_agent_change_counts",
  "get_user_agent_changed_file",
  "get_user_agent_changes",
  "get_user_agent_chat",
  "get_user_agent_draft",
  "get_user_agent_turn_activity",
  "list_agent_projects",
  "list_agent_tasks",
  "list_available_workers",
]);

const defaults: Settings = {
  source: "fixtures",
  launch: "thread",
  theme: "light",
  displayMode: "inline",
  width: "480",
  canSend: true,
  canShare: true,
  showInspector: false,
  // The fixtures give most of their tasks to this thread.
  threadId: PREVIEW_THREAD,
  cwd: __DEV_HOST_CWD__,
  autoRegister: true,
  claudeUnavailable: false,
  successfulBudgetUpdates: false,
  slowAsyncReads: false,
  addedProjects: [],
  removedProjects: [],
  projectNames: {},
  styles: "",
};

const widths = [
  ["360", "360px"],
  ["480", "480px"],
  ["760", "760px"],
  ["fill", "Fill"],
];

function loadSettings(): Settings {
  try {
    return settingsFrom(defaults, localStorage.getItem(storageKey));
  } catch {
    return defaults;
  }
}

function hostContext(settings: Settings): McpUiHostContext {
  const variables = parseStyles(settings.styles);

  return {
    theme: settings.theme,
    displayMode: settings.displayMode,
    availableDisplayModes: ["inline", "fullscreen"],
    platform: "desktop",
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(variables ? { styles: { variables } } : {}),
  } as McpUiHostContext;
}

const fixtureThreads = threadsOf(
  previewTool("list_agent_tasks", { conversation_id: null }) as Task[],
);

// The only export, so Fast Refresh can swap it in place. main.tsx mounts it.
export function Host() {
  const [settings, setSettings] = useState(loadSettings);
  const [viewState] = useState(() => browserUiState());

  const [activeInspectorTab, setActiveInspectorTab] =
    useState<InspectorTab>("bridge-log");

  const [session, setSession] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [height, setHeight] = useState(240);
  const [bridge, setBridge] = useState<AppBridge>();
  const [liveThreads, setLiveThreads] = useState<Thread[]>([]);
  // Read by the running session's tool calls, which a registration must not relaunch.
  const added = useRef(settings.addedProjects);

  const projectEdits = useRef({
    removed: settings.removedProjects ?? [],
    names: settings.projectNames ?? {},
  });

  const frame = useRef<HTMLIFrameElement>(null);

  const update = (patch: Partial<Settings>) =>
    setSettings((current) => ({ ...current, ...patch }));

  // Clearing projects changes what the panel was launched with, so relaunch.
  const resetProjects = () => {
    added.current = [];
    projectEdits.current = { removed: [], names: {} };
    update({ addedProjects: [], removedProjects: [], projectNames: {} });
    setSession((n) => n + 1);
  };

  // Arrow keys move and activate tabs; Home and End select the endpoints.
  const handleInspectorTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );

    const currentIndex = tabs.indexOf(event.target as HTMLButtonElement);
    if (currentIndex < 0) return;

    event.preventDefault();

    let nextIndex =
      (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
      tabs.length;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;

    const nextTab = inspectorTabs.at(nextIndex);

    if (!nextTab) return;

    setActiveInspectorTab(nextTab.id);
    tabs[nextIndex]?.focus();
  };

  // Clears the inspector and returns focus to the toggle that opened it.
  const closeInspector = () => {
    update({ showInspector: false });

    requestAnimationFrame(() =>
      document.getElementById("inspector-toggle")?.focus(),
    );
  };

  // Keep recording while closed so Bridge log can show the session history later.
  const record = (kind: string, detail?: unknown) =>
    setLog((entries) =>
      [
        {
          id: (entries[0]?.id ?? 0) + 1,
          time: new Date().toLocaleTimeString(),
          kind,
          detail,
        },
        ...entries,
      ].slice(0, 200),
    );

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {}

    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    const hostWindow = window as DevHostWindow;
    hostWindow.__CODEX_SUBAGENT_DEV_UI_STATE__ = viewState;

    return () => {
      if (hostWindow.__CODEX_SUBAGENT_DEV_UI_STATE__ === viewState) {
        delete hostWindow.__CODEX_SUBAGENT_DEV_UI_STATE__;
      }
    };
  }, [viewState]);

  // Settings fixed at initialization; changing one starts a new panel session.
  const {
    source,
    launch,
    canSend,
    canShare,
    threadId,
    cwd,
    autoRegister,
    claudeUnavailable,
    successfulBudgetUpdates,
    slowAsyncReads,
  } = settings;

  const sessionKey = JSON.stringify([
    session,
    source,
    launch,
    canSend,
    canShare,
    threadId,
    cwd,
    autoRegister,
    claudeUnavailable,
    successfulBudgetUpdates,
    slowAsyncReads,
  ]);

  useEffect(() => {
    const iframe = frame.current!;
    const view = iframe.contentWindow!;
    const current = { ...settings };

    const capabilities: McpUiHostCapabilities = {
      serverTools: {},
      openLinks: {},
      logging: {},
      ...(canSend ? { message: { text: {} } } : {}),
      ...(canShare ? { updateModelContext: { structuredContent: {} } } : {}),
    };

    const next = new AppBridge(
      null,
      { name: "Panel dev host", version: "0.0.0" },
      capabilities,
      { hostContext: hostContext(current) },
    );

    let client: Promise<Client> | undefined;

    const service = () =>
      (client ??= (async () => {
        const connection = new Client({
          name: "panel-dev-host",
          version: "0.0.0",
        });

        await connection.connect(
          new StreamableHTTPClientTransport(
            new URL("/service/mcp", location.origin),
          ),
        );

        return connection;
      })());

    // Offer the service's threads in the Thread picker. Read-only, and not
    // part of the panel's traffic, so it stays out of the bridge log.
    if (source === "live") {
      void service()
        .then((connection) =>
          connection.callTool({
            name: "list_agent_tasks",
            arguments: { conversation_id: null },
          }),
        )
        .then((result) =>
          setLiveThreads(
            threadsOf(
              (result.structuredContent as { result?: Task[] } | undefined)
                ?.result ?? [],
            ),
          ),
        )
        .catch(() => setLiveThreads([]));
    }

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      // Fixture service tools run the real service code on the Vite server.
      let served = "browser fixtures";
      if (source === "live") served = "service";
      else if (FIXTURE_SERVICE_TOOLS.includes(name)) served = "fixture service";

      let result;

      if (served === "service") {
        result = (await (
          await service()
        ).callTool({
          name,
          arguments: args,
          _meta: codexMeta(current),
        })) as CallToolResult;
      } else if (served === "fixture service") {
        result = await fixtureServiceCall(name, args);
      } else {
        result = fixtureCall(name, args, {
          autoRegisterChatProject: current.autoRegister,
          claudeUnavailable: current.claudeUnavailable,
          successfulBudgetUpdates: current.successfulBudgetUpdates,
          deferTaskList: current.slowAsyncReads,
          addedProjects: added.current,
          removedProjects: projectEdits.current.removed,
          projectNames: projectEdits.current.names,
        });
      }

      if (
        source === "fixtures" &&
        current.slowAsyncReads &&
        fixtureReadTools.has(name)
      ) {
        await new Promise((resolve) => setTimeout(resolve, fixtureReadDelayMs));
      }

      // Fixture registrations persist until Reset, like the service's registry.
      if (
        source === "fixtures" &&
        name === "register_user_agent_project" &&
        !result.isError
      ) {
        const { repository } = (
          result.structuredContent as { result: { repository: string } }
        ).result;

        projectEdits.current.removed = projectEdits.current.removed.filter(
          (path) => path !== repository,
        );

        update({ removedProjects: projectEdits.current.removed });

        if (!added.current.includes(repository)) {
          added.current = [...added.current, repository];
          update({ addedProjects: added.current });
        }
      }

      if (
        source === "fixtures" &&
        !result.isError &&
        (name === "rename_user_agent_project" ||
          name === "remove_user_agent_project")
      ) {
        const changed = (
          result.structuredContent as {
            result: { repository: string; name?: string };
          }
        ).result;

        if (name === "rename_user_agent_project") {
          projectEdits.current.names = {
            ...projectEdits.current.names,
            [changed.repository]: changed.name!,
          };
        } else {
          projectEdits.current = removeFixtureProject(
            projectEdits.current,
            changed.repository,
          );
        }

        update({
          removedProjects: projectEdits.current.removed,
          projectNames: projectEdits.current.names,
        });
      }

      record(result.isError ? "tool error" : "tool", {
        name,
        served,
        arguments: args,
        result,
      });

      return result;
    };

    next.oncalltool = async ({ name, arguments: args }) => {
      try {
        return await call(name, args);
      } catch (error) {
        record("tool error", { name, arguments: args, error: String(error) });
        throw error;
      }
    };

    // Codex renders the panel as the result of its launch tool.
    const openPanel = async () => {
      record("initialized");

      const name =
        launch === "global"
          ? "open_codex_subagent_extension_global"
          : "open_codex_subagent_extension";

      try {
        const result = await call(
          name,
          source === "live" ? {} : fixtureLaunchArgs(current),
        );

        await next.sendToolInput({ arguments: {} });
        await next.sendToolResult(result);
      } catch (error) {
        record("launch error", String(error));
      }
    };

    // openPanel records its own failures.
    next.addEventListener("initialized", () => void openPanel());

    next.onrequestdisplaymode = async ({ mode }) => {
      record("display mode", mode);
      update({ displayMode: mode });

      return { mode };
    };

    next.addEventListener("sizechange", (size) => {
      if (size.height) setHeight(size.height);
    });

    next.onmessage = async (params) => {
      record("message", params);

      return {};
    };

    next.onupdatemodelcontext = async (params) => {
      record("model context", params);

      return {};
    };

    next.onopenlink = async ({ url }) => {
      record("open link", url);
      window.open(url, "_blank", "noopener");

      return {};
    };

    next.addEventListener("loggingmessage", (params) => record("log", params));

    // Listen before the document loads: the panel sends initialize at startup.
    void next.connect(new PostMessageTransport(view, view)).then(() => {
      iframe.src = "./panel.html";
    });

    setBridge(next);

    return () => {
      setBridge(undefined);
      void next.close();
      void client?.then((connection) => connection.close());
    };
    // sessionKey covers every setting fixed at initialization; the rest is
    // pushed as host context below, so other changes must not relaunch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const { theme, displayMode, styles } = settings;

  useEffect(() => {
    bridge?.setHostContext(hostContext(settings));
    // Only these settings are part of the host context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, theme, displayMode, styles]);

  const inline = displayMode === "inline";
  const knownThreads = source === "live" ? liveThreads : fixtureThreads;

  // Keep a typed-in Thread ID selectable even when it has no tasks yet.
  const threadOptions = knownThreads.some((thread) => thread.id === threadId)
    ? knownThreads
    : [{ id: threadId, latest: "", tasks: 0 }, ...knownThreads];

  return (
    <div
      className={`host${settings.showInspector ? " inspector-open" : " inspector-closed"}`}
    >
      <header className="toolbar">
        <label>
          Data
          <select
            value={source}
            onChange={(e) =>
              update({ source: e.target.value as Settings["source"] })
            }
          >
            <option value="fixtures">Fixtures</option>
            <option value="live">Live service</option>
          </select>
        </label>
        <label>
          Launch
          <select
            value={launch}
            onChange={(e) =>
              update({ launch: e.target.value as Settings["launch"] })
            }
          >
            <option value="thread">Thread</option>
            <option value="global">Global</option>
          </select>
        </label>
        {launch === "thread" && (
          <label>
            Thread
            <select
              className="thread"
              value={threadId}
              onChange={(e) => update({ threadId: e.target.value })}
            >
              {threadOptions.map((thread) => (
                <option key={thread.id} value={thread.id} title={thread.id}>
                  {threadLabel(thread)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Theme
          <select
            value={theme}
            onChange={(e) =>
              update({ theme: e.target.value as Settings["theme"] })
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Display
          <select
            value={displayMode}
            onChange={(e) =>
              update({ displayMode: e.target.value as McpUiDisplayMode })
            }
          >
            <option value="inline">Inline</option>
            <option value="fullscreen">Fullscreen</option>
          </select>
        </label>
        <label>
          Width
          <select
            value={settings.width}
            onChange={(e) => update({ width: e.target.value })}
          >
            {widths.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={canSend}
            onChange={(e) => update({ canSend: e.target.checked })}
          />
          Send messages
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={canShare}
            onChange={(e) => update({ canShare: e.target.checked })}
          />
          Update context
        </label>
        {source === "fixtures" && (
          <label
            className="check"
            title="Simulates successful limit updates in preview fixtures."
          >
            <input
              type="checkbox"
              checked={successfulBudgetUpdates}
              onChange={(e) =>
                update({ successfulBudgetUpdates: e.target.checked })
              }
            />
            Successful limit updates
          </label>
        )}
        {source === "fixtures" && (
          <label
            className="check"
            title="Delays fixture content reads by 1.2 seconds so loading placeholders can be inspected."
          >
            <input
              type="checkbox"
              checked={settings.slowAsyncReads}
              onChange={(e) => update({ slowAsyncReads: e.target.checked })}
            />
            Slow async reads
          </label>
        )}
        <button type="button" onClick={() => setSession((n) => n + 1)}>
          Relaunch
        </button>
        <button
          id="inspector-toggle"
          type="button"
          className={`inspector-toggle${settings.showInspector ? " active" : ""}`}
          aria-expanded={settings.showInspector}
          aria-controls="inspector-pane"
          onClick={() => update({ showInspector: !settings.showInspector })}
        >
          Inspector
        </button>
      </header>
      <main className="stage">
        <div
          className={`frame ${inline ? "inline" : "fullscreen"}`}
          style={{
            width: settings.width === "fill" ? "100%" : `${settings.width}px`,
            ...(inline ? { height } : {}),
          }}
        >
          <iframe ref={frame} key={sessionKey} title="Delegated Work" />
        </div>
      </main>
      <aside
        id="inspector-pane"
        className="inspector"
        aria-label="Development inspector"
        hidden={!settings.showInspector}
      >
        <div className="inspector-header">
          <div
            className="inspector-tabs"
            role="tablist"
            aria-label="Inspector sections"
            onKeyDown={handleInspectorTabKeyDown}
          >
            {inspectorTabs.map(({ id, label }) => (
              <button
                key={id}
                id={`inspector-tab-${id}`}
                className="inspector-tab"
                type="button"
                role="tab"
                aria-selected={activeInspectorTab === id}
                aria-controls="inspector-panel"
                tabIndex={activeInspectorTab === id ? 0 : -1}
                onClick={() => setActiveInspectorTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="inspector-close"
            type="button"
            aria-label="Close inspector"
            title="Close inspector"
            onClick={closeInspector}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <section
          id="inspector-panel"
          className="inspector-panel"
          role="tabpanel"
          aria-labelledby={`inspector-tab-${activeInspectorTab}`}
          tabIndex={0}
        >
          {activeInspectorTab === "bridge-log" && (
            <>
              <div className="inspector-section-header">
                <strong>Bridge log</strong>
                <button type="button" onClick={() => setLog([])}>
                  Clear
                </button>
              </div>
              <ol className="log-entries">
                {log.map((entry) => (
                  <li key={entry.id}>
                    <details>
                      <summary>
                        <time>{entry.time}</time> <b>{entry.kind}</b>{" "}
                        {summarize(entry)}
                      </summary>
                      <pre>{JSON.stringify(entry.detail, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            </>
          )}
          {activeInspectorTab === "host-settings" && (
            <div className="host-settings">
              <label>
                Thread ID
                <input
                  key={`thread-${session}-${threadId}`}
                  defaultValue={threadId}
                  disabled={launch === "global"}
                  onBlur={(e) => update({ threadId: e.target.value.trim() })}
                />
              </label>
              <label>
                Sandbox cwd
                <input
                  key={`cwd-${session}-${cwd}`}
                  defaultValue={cwd}
                  disabled={launch === "global"}
                  placeholder="file:///path/to/repository"
                  onBlur={(e) => update({ cwd: normalizeCwd(e.target.value) })}
                />
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={autoRegister}
                  disabled={source === "live"}
                  onChange={(e) => update({ autoRegister: e.target.checked })}
                />
                <span
                  title={
                    source === "live"
                      ? "The live service uses your own setting."
                      : undefined
                  }
                >
                  Automatically add chat projects
                </span>
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={claudeUnavailable}
                  disabled={source === "live"}
                  onChange={(e) =>
                    update({ claudeUnavailable: e.target.checked })
                  }
                />
                <span
                  title={
                    source === "live"
                      ? "The live service checks your installed Claude Code."
                      : undefined
                  }
                >
                  Claude Code unavailable
                </span>
              </label>
              <div className="added-projects">
                <span>Added projects (fixtures)</span>
                {settings.addedProjects.length ? (
                  <ul>
                    {settings.addedProjects.map((repository) => (
                      <li key={repository}>{repository}</li>
                    ))}
                  </ul>
                ) : (
                  <small>None. Add project registers here until reset.</small>
                )}
                <button
                  type="button"
                  disabled={!hasProjectEdits(settings)}
                  onClick={resetProjects}
                >
                  Reset projects
                </button>
              </div>
              <label>
                Host style variable overrides (JSON)
                <textarea
                  rows={6}
                  value={styles}
                  placeholder='{"--color-background-primary": "#fff"}'
                  onChange={(e) => update({ styles: e.target.value })}
                />
                <small>
                  Leave blank to omit host style variables. Captured light and
                  dark maps are available as development references.
                </small>
              </label>
            </div>
          )}
          {activeInspectorTab === "icon-catalog" && (
            <>
              <div className="inspector-section-header">
                <strong>Panel icons</strong>
                <span>{iconNames.length}</span>
              </div>
              <ul className="icon-catalog" aria-label="Panel icon catalog">
                {iconNames.map((name) => (
                  <li key={name} className="icon-catalog-item">
                    <Icon name={name} size={18} />
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

function summarize(entry: LogEntry) {
  const detail = entry.detail as { name?: string } | string | undefined;

  return typeof detail === "string" ? detail : (detail?.name ?? "");
}
