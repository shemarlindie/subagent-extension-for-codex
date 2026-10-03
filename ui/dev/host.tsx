// Mock MCP Apps host for panel development. It embeds the panel the way Codex
// does (iframe + AppBridge), so the panel runs its real HostTransport, and
// answers tool calls from fixtures or the running service over MCP.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppBridge,
  PostMessageTransport,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { previewTool } from "../transports/preview-tools";
import "./host.css";

type Settings = {
  source: "fixtures" | "live";
  launch: "thread" | "global";
  theme: "light" | "dark";
  displayMode: McpUiDisplayMode;
  width: string;
  canSend: boolean;
  canShare: boolean;
  threadId: string;
  cwd: string;
  styles: string;
};
type LogEntry = { id: number; time: string; kind: string; detail: unknown };

const storageKey = "panel-dev-host";
const defaults: Settings = {
  source: "fixtures",
  launch: "thread",
  theme: "light",
  displayMode: "inline",
  width: "480",
  canSend: true,
  canShare: true,
  threadId: "dev-thread",
  cwd: __DEV_HOST_CWD__,
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
    return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey)!) };
  } catch {
    return defaults;
  }
}
function parseStyles(text: string): Record<string, string> | undefined {
  try {
    const value = JSON.parse(text);
    // Accept either the variables map or a whole hostContext.styles object.
    return value?.variables ?? value;
  } catch {
    return undefined;
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
/** Request metadata Codex attaches to tool calls from a thread. */
function codexMeta(settings: Settings) {
  if (settings.launch === "global") return undefined;
  return {
    ...(settings.threadId ? { threadId: settings.threadId } : {}),
    ...(settings.cwd
      ? { "codex/sandbox-state-meta": { sandboxCwd: settings.cwd } }
      : {}),
  };
}
function fixtureCall(name: string, args: Record<string, unknown> = {}) {
  try {
    const result = previewTool(name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: (name.endsWith("_agent_settings")
        ? result
        : { result }) as Record<string, unknown>,
    } satisfies CallToolResult;
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: String(error) }],
    } satisfies CallToolResult;
  }
}

function Host() {
  const [settings, setSettings] = useState(loadSettings);
  const [session, setSession] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [height, setHeight] = useState(240);
  const [bridge, setBridge] = useState<AppBridge>();
  const frame = useRef<HTMLIFrameElement>(null);
  const update = (patch: Partial<Settings>) =>
    setSettings((current) => ({ ...current, ...patch }));
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

  // Settings fixed at initialization; changing one starts a new panel session.
  const { source, launch, canSend, canShare, threadId, cwd } = settings;
  const sessionKey = JSON.stringify([
    session,
    source,
    launch,
    canSend,
    canShare,
    threadId,
    cwd,
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
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result =
        source === "live"
          ? ((await (
              await service()
            ).callTool({
              name,
              arguments: args,
              _meta: codexMeta(current),
            })) as CallToolResult)
          : fixtureCall(name, args);
      record(result.isError ? "tool error" : "tool", {
        name,
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
    next.oninitialized = async () => {
      record("initialized");
      // Codex renders the panel as the result of its launch tool.
      const name =
        launch === "global"
          ? "open_codex_subagent_extension_global"
          : "open_codex_subagent_extension";
      try {
        const result =
          source === "live"
            ? await call(name)
            : {
                content: [],
                structuredContent: previewTool(
                  "get_agent_panel_context",
                ) as Record<string, unknown>,
              };
        await next.sendToolInput({ arguments: {} });
        await next.sendToolResult(result);
      } catch (error) {
        record("launch error", String(error));
      }
    };
    next.onrequestdisplaymode = async ({ mode }) => {
      record("display mode", mode);
      update({ displayMode: mode });
      return { mode };
    };
    next.onsizechange = (size) => {
      if (size.height) setHeight(size.height);
    };
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
    next.onloggingmessage = (params) => record("log", params);
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
  return (
    <div className="host">
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
        <button type="button" onClick={() => setSession((n) => n + 1)}>
          Relaunch
        </button>
        <details className="more">
          <summary>Host</summary>
          <label>
            Thread ID
            <input
              key={`thread-${session}`}
              defaultValue={threadId}
              disabled={launch === "global"}
              onBlur={(e) => update({ threadId: e.target.value.trim() })}
            />
          </label>
          <label>
            Sandbox cwd
            <input
              key={`cwd-${session}`}
              defaultValue={cwd}
              disabled={launch === "global"}
              onBlur={(e) => update({ cwd: e.target.value.trim() })}
            />
          </label>
          <label>
            Host style variables (JSON)
            <textarea
              rows={6}
              value={styles}
              placeholder='{"--color-background-primary": "#fff"}'
              onChange={(e) => update({ styles: e.target.value })}
            />
          </label>
        </details>
      </header>
      <main className="stage">
        <div
          className={`frame ${inline ? "inline" : "fullscreen"}`}
          style={{
            width: settings.width === "fill" ? "100%" : `${settings.width}px`,
            ...(inline ? { height } : {}),
          }}
        >
          <iframe ref={frame} key={sessionKey} title="Delegated work" />
        </div>
      </main>
      <aside className="log">
        <div className="log-header">
          <strong>Bridge log</strong>
          <button type="button" onClick={() => setLog([])}>
            Clear
          </button>
        </div>
        <ol>
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
      </aside>
    </div>
  );
}
function summarize(entry: LogEntry) {
  const detail = entry.detail as { name?: string } | string | undefined;
  return typeof detail === "string" ? detail : (detail?.name ?? "");
}

createRoot(document.getElementById("root")!).render(<Host />);
