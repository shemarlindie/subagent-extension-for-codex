import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { PanelData, Transport, TransportEvents } from "../core/types";
export class HostTransport implements Transport {
  readonly embedded = true;
  readonly preview = false;
  private disposed = false;
  private events?: TransportEvents;
  constructor(
    private app = new App(
      { name: "Delegated work", version: "0.1.0" },
      {},
      { autoResize: true },
    ),
    private legacyConsole = false,
  ) {}
  async connect(events: TransportEvents) {
    this.events = events;
    this.app.ontoolresult = (result) => {
      if (!this.disposed) {
        const data = result.structuredContent as PanelData;
        const meta = result._meta as { conversation_id?: string } | undefined;
        events.scope(
          this.legacyConsole && !data?.panel_scope && Array.isArray(data?.tasks)
            ? {
                ...data,
                panel_scope: { conversation_id: meta?.conversation_id ?? null },
              }
            : data,
        );
      }
    };
    this.app.onhostcontextchanged = () => this.updateHost();
    this.app.onteardown = async () => {
      this.dispose();
      events.teardown();
      return {};
    };
    await this.app.connect();
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
