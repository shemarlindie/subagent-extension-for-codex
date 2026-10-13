import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import {
  OPENAI_MESSAGE_KEY,
  OpenAIMessageParamsSchema,
} from "@openai/mcp-extensions/app";

import type { PanelData, Transport, TransportEvents } from "../app/state/types";
import { decodePanelToolResult } from "./event-decoding";
import { HostContextCompatibilityTransport } from "./host-context-compat";
import { traceSize } from "./size-trace";

// DEBUG: Trace the SDK's outgoing sizes without replacing its resize observer.
class SizeTracingApp extends App {
  override sendSizeChanged(params: Parameters<App["sendSizeChanged"]>[0]) {
    traceSize("size-notification", params);

    return super.sendSizeChanged(params);
  }
}

function toolRequestOptions(name: string, args: Record<string, unknown>) {
  if (name === "browse_user_agent_project") return { timeout: 150000 };

  // A draft read waits as long as it was asked to, plus a margin.
  if (name === "get_user_agent_draft") {
    return { timeout: Number(args.wait_ms ?? 0) + 10000 };
  }

  return undefined;
}

export class HostTransport implements Transport {
  readonly embedded = true;
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

    this.app.addEventListener("toolresult", (result) => {
      if (!this.disposed) {
        // DEBUG: Mark when task data arrives without recording its contents.
        traceSize("tool-result-received");
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

    // DEBUG: Automatic resize reporting starts after this handshake completes.
    traceSize("bridge-connected");
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
    // DEBUG: Correlate host mode changes with viewport and card measurements.
    traceSize("host-context", { displayMode });
    const capabilities = this.app.getHostCapabilities();

    this.events?.host({
      ...(context?.locale ? { locale: context.locale } : {}),
      ...(context?.timeZone ? { timeZone: context.timeZone } : {}),
      displayMode,
      canExpand: Boolean(
        context?.availableDisplayModes?.includes(
          displayMode === "fullscreen" ? "inline" : "fullscreen",
        ),
      ),
      canSend: Boolean(capabilities?.message?.text),
      canSendParent: capabilities?.experimental?.[OPENAI_MESSAGE_KEY] != null,
      canShare: Boolean(capabilities?.updateModelContext?.structuredContent),
    });
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.disposed) throw new Error("The console has closed.");

    const userTools: Record<string, string> = {
      start_agent_task: "start_user_agent_task",
      submit_agent_input: "submit_user_agent_input",
      send_agent_message: "send_user_agent_message",
      remove_agent_queued_message: "remove_user_agent_queued_message",
      update_agent_settings: "update_user_agent_settings",
    };

    const result = await this.app.callServerTool(
      {
        name: userTools[name] ?? name,
        arguments: args,
      },
      toolRequestOptions(name, args),
    );

    if (result.isError) {
      throw new Error(
        result.content
          .map((item) => (item.type === "text" ? item.text : ""))
          .join("\n") || "The tool failed.",
      );
    }

    const body = result.structuredContent;

    if (!body) throw new Error("The service returned no structured data.");

    return name.endsWith("_agent_settings")
      ? (body as T)
      : decodePanelToolResult<T>(name, body.result);
  }

  watch() {}
  dispose() {
    this.disposed = true;
  }

  async send(text: string, options?: { submit?: boolean }) {
    if (this.disposed) throw new Error("The console has closed.");

    if (
      options?.submit &&
      this.app.getHostCapabilities()?.experimental?.[OPENAI_MESSAGE_KEY] == null
    ) {
      throw new Error("This host does not support submitting worker messages.");
    }

    const params = OpenAIMessageParamsSchema.parse({
      role: "user",
      content: [{ type: "text", text }],
      ...(options?.submit
        ? { _meta: { [OPENAI_MESSAGE_KEY]: { target: "active", send: true } } }
        : {}),
    });

    const result = await this.app.sendMessage(params);

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

    const mode =
      context?.displayMode === "fullscreen" ? "inline" : "fullscreen";

    if (context?.availableDisplayModes?.includes(mode)) {
      await this.app.requestDisplayMode({ mode });
    }
  }
}
