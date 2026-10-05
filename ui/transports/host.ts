import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

import { traceSize } from "../core/size-trace";
import type { PanelData, Transport, TransportEvents } from "../core/types";

// DEBUG: Trace the SDK's outgoing sizes without replacing its resize observer.
class SizeTracingApp extends App {
  override sendSizeChanged(params: Parameters<App["sendSizeChanged"]>[0]) {
    traceSize("size-notification", params);

    return super.sendSizeChanged(params);
  }
}

export class HostTransport implements Transport {
  readonly embedded = true;
  readonly preview = false;
  private disposed = false;
  private events?: TransportEvents;
  constructor(
    // DEBUG: Use the tracing subclass until the panel sizing investigation is complete.
    private app: App = new SizeTracingApp(
      { name: "Delegated Work", version: "0.1.0" },
      {},
      { autoResize: true },
    ),
  ) {}

  async connect(events: TransportEvents) {
    this.events = events;
    // DEBUG: Compare handshake timing with the first compact render and size notification.
    traceSize("bridge-connect-start");

    this.app.ontoolresult = (result) => {
      if (!this.disposed) {
        // DEBUG: Mark when task data arrives without recording its contents.
        traceSize("tool-result-received");
        const data = result.structuredContent as PanelData;
        events.scope(data);
      }
    };

    this.app.onhostcontextchanged = () => this.updateHost();

    this.app.onteardown = async () => {
      this.dispose();
      events.teardown();

      return {};
    };

    await this.app.connect();
    // DEBUG: Automatic resize reporting starts after this handshake completes.
    traceSize("bridge-connected");
    if (this.disposed) return;
    if (!this.app.getHostCapabilities()?.serverTools)
      throw new Error("This host does not support the console’s MCP tools.");
    this.updateHost();
  }

  private updateHost() {
    if (this.disposed) return;
    const context = this.app.getHostContext();
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables)
      applyHostStyleVariables(context.styles.variables);
    const displayMode = context?.displayMode ?? "inline";
    // DEBUG: Correlate host mode changes with viewport and card measurements.
    traceSize("host-context", { displayMode });
    const capabilities = this.app.getHostCapabilities();

    this.events?.host({
      displayMode,
      canExpand: Boolean(
        context?.availableDisplayModes?.includes(
          displayMode === "fullscreen" ? "inline" : "fullscreen",
        ),
      ),
      canSend: Boolean(capabilities?.message?.text),
      canShare: Boolean(capabilities?.updateModelContext?.structuredContent),
    });
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.disposed) throw new Error("The console has closed.");

    const userTools: Record<string, string> = {
      start_agent_task: "start_user_agent_task",
      submit_agent_input: "submit_user_agent_input",
      update_agent_settings: "update_user_agent_settings",
    };

    const result = await this.app.callServerTool(
      {
        name: userTools[name] ?? name,
        arguments: args,
      },
      name === "browse_user_agent_project" ? { timeout: 150000 } : undefined,
    );

    if (result.isError)
      throw new Error(
        result.content
          ?.map((item) => (item.type === "text" ? item.text : ""))
          .join("\n") || "The tool failed.",
      );

    const body = result.structuredContent as
      Record<string, unknown> | undefined;

    if (!body) throw new Error("The service returned no structured data.");

    return (name.endsWith("_agent_settings") ? body : body.result) as T;
  }

  watch() {}
  dispose() {
    this.disposed = true;
  }

  async send(text: string) {
    if (this.disposed) throw new Error("The console has closed.");

    const result = await this.app.sendMessage({
      role: "user",
      content: [{ type: "text", text }],
    });

    if (result.isError)
      throw new Error(
        "The host declined delivery. Select and copy the message into Codex instead.",
      );
  }

  async share(structuredContent: Record<string, unknown>) {
    if (this.disposed) throw new Error("The console has closed.");
    await this.app.updateModelContext({ structuredContent });
  }

  async expand() {
    if (this.disposed) throw new Error("The console has closed.");
    const context = this.app.getHostContext();

    const mode =
      context?.displayMode === "fullscreen" ? "inline" : "fullscreen";

    if (context?.availableDisplayModes?.includes(mode))
      await this.app.requestDisplayMode({ mode });
  }
}
