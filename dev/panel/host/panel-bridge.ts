// Embeds the panel the way Codex does: an iframe and an AppBridge, so the
// panel runs its real HostTransport. Shared by the dev host and the showcase.
import {
  AppBridge,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type PanelBridgeOptions = {
  name: string;
  capabilities: McpUiHostCapabilities;
  hostContext: McpUiHostContext;
  /** Answers the panel's tool calls. */
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<CallToolResult>;
  /** Calls the launch tool. Codex renders the panel as its result. */
  launch: () => Promise<CallToolResult>;
  /** Receives bridge traffic for inspection. */
  record?: (kind: string, detail?: unknown) => void;
  onDisplayMode?: (mode: McpUiDisplayMode) => void;
  onHeight?: (height: number) => void;
  onMessage?: (params: unknown) => void;
};

/** Connects a bridge to the iframe, then loads the panel document into it. */
export function connectPanel(
  iframe: HTMLIFrameElement,
  src: string,
  options: PanelBridgeOptions,
) {
  const view = iframe.contentWindow!;
  const record = options.record ?? (() => {});

  const bridge = new AppBridge(
    null,
    { name: options.name, version: "0.0.0" },
    options.capabilities,
    { hostContext: options.hostContext },
  );

  bridge.oncalltool = async ({ name, arguments: args = {} }) => {
    try {
      return await options.callTool(name, args);
    } catch (error) {
      record("tool error", { name, arguments: args, error: String(error) });
      throw error;
    }
  };

  const openPanel = async () => {
    record("initialized");

    try {
      const result = await options.launch();

      await bridge.sendToolInput({ arguments: {} });
      await bridge.sendToolResult(result);
    } catch (error) {
      record("launch error", String(error));
    }
  };

  // openPanel records its own failures.
  bridge.addEventListener("initialized", () => void openPanel());

  bridge.onrequestdisplaymode = async ({ mode }) => {
    record("display mode", mode);
    options.onDisplayMode?.(mode);

    return { mode };
  };

  bridge.addEventListener("sizechange", (size) => {
    if (size.height) options.onHeight?.(size.height);
  });

  bridge.onmessage = async (params) => {
    record("message", params);
    options.onMessage?.(params);

    return {};
  };

  bridge.onupdatemodelcontext = async (params) => {
    record("model context", params);

    return {};
  };

  bridge.onopenlink = async ({ url }) => {
    record("open link", url);
    window.open(url, "_blank", "noopener");

    return {};
  };

  bridge.ondownloadfile = async (params) => {
    record("download file", params);

    return {};
  };

  bridge.addEventListener("loggingmessage", (params) => record("log", params));

  // Listen before the document loads: the panel sends initialize at startup.
  void bridge.connect(new PostMessageTransport(view, view)).then(() => {
    iframe.src = src;
  });

  return bridge;
}
