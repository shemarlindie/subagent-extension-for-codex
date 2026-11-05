import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

import { version } from "../../../package.json";
import { SendRejectedError } from "../../shared/tasks/conversation/send-errors";
import type { PanelData, Transport, TransportEvents } from "../app/state/types";
import { decodePanelToolResult } from "./event-decoding";
import { HostContextCompatibilityTransport } from "./host-context-compat";

function toolRequestOptions(name: string, args: Record<string, unknown>) {
  if (name === "app_browse_project") return { timeout: 150000 };

  // An update wait holds as long as it was asked to, plus a margin.
  if (name === "app_wait_for_updates") {
    return { timeout: Number(args.wait_ms ?? 0) + 10000 };
  }

  return undefined;
}

export class HostTransport implements Transport {
  readonly embedded = true;
  private disposed = false;
  private events?: TransportEvents;
  constructor(
    private app: App = new App(
      { name: "Delegated Work", version },
      {},
      { autoResize: true },
    ),
  ) {}

  async connect(events: TransportEvents) {
    this.events = events;

    this.app.addEventListener("toolresult", (result) => {
      if (!this.disposed) {
        const data = result.structuredContent as PanelData;
        events.scope(data);
      }
    });

    this.app.addEventListener("hostcontextchanged", () => this.updateHost());

    this.app.onteardown = async () => {
      this.dispose();
      events.teardown();

      return {};
    };

    await this.app.connect(
      typeof window === "undefined"
        ? undefined
        : new HostContextCompatibilityTransport(),
    );

    if (this.disposed) return;

    if (!this.app.getHostCapabilities()?.serverTools) {
      throw new Error("This host does not support the console’s MCP tools.");
    }

    this.updateHost();
  }

  private updateHost() {
    if (this.disposed) return;
    const context = this.app.getHostContext();
    if (context?.theme) applyDocumentTheme(context.theme);

    if (context?.styles?.variables) {
      applyHostStyleVariables(context.styles.variables);
    }

    const displayMode = context?.displayMode ?? "inline";
    const capabilities = this.app.getHostCapabilities();

    this.events?.host({
      ...(context?.locale ? { locale: context.locale } : {}),
      ...(context?.timeZone ? { timeZone: context.timeZone } : {}),
      displayMode,
      canExpand: Boolean(
        context?.availableDisplayModes?.includes("fullscreen"),
      ),
      canSend: Boolean(capabilities?.message?.text),
      canShare: Boolean(capabilities?.updateModelContext?.structuredContent),
    });
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.disposed) throw new Error("The console has closed.");

    const userTools: Record<string, string> = {
      start_task: "app_start_task",
      submit_input: "app_submit_input",
      send_message: "app_send_message",
      remove_queued_message: "app_remove_queued_message",
      update_settings: "app_update_settings",
    };

    const result = await this.app.callServerTool(
      {
        name: userTools[name] ?? name,
        arguments: args,
      },
      toolRequestOptions(name, args),
    );

    if (result.isError) {
      const Failure =
        result._meta?.send_rejected === true ? SendRejectedError : Error;

      throw new Failure(
        result.content
          .map((item) => (item.type === "text" ? item.text : ""))
          .join("\n") || "The tool failed.",
      );
    }

    const body = result.structuredContent;

    if (!body) throw new Error("The service returned no structured data.");

    // A tool with an output schema sends its result as the structured content.
    return "result" in body
      ? decodePanelToolResult<T>(name, body.result, this.events?.timing)
      : (body as T);
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

    if (result.isError) {
      throw new Error(
        "The host declined delivery. Select and copy the message into Codex instead.",
      );
    }
  }

  async share(structuredContent: Record<string, unknown>) {
    if (this.disposed) throw new Error("The console has closed.");
    await this.app.updateModelContext({ structuredContent });
  }

  async openLink(url: string) {
    if (this.disposed) throw new Error("The console has closed.");
    const result = await this.app.openLink({ url });
    if (result.isError) throw new Error("The host declined to open the link.");
  }

  async expand() {
    if (this.disposed) throw new Error("The console has closed.");
    const context = this.app.getHostContext();

    if (context?.availableDisplayModes?.includes("fullscreen")) {
      await this.app.requestDisplayMode({ mode: "fullscreen" });
    }
  }
}
