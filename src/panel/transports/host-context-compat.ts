import {
  McpUiHostStylesSchema,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filterHostContext(context: unknown) {
  if (!isRecord(context) || !isRecord(context.styles)) return context;

  const variables = context.styles.variables;
  if (!isRecord(variables)) return context;

  const supportedVariables = Object.fromEntries(
    Object.entries(variables).filter(
      ([key, value]) =>
        McpUiHostStylesSchema.safeParse({ variables: { [key]: value } })
          .success,
    ),
  );

  if (
    Object.keys(supportedVariables).length === Object.keys(variables).length
  ) {
    return context;
  }

  return {
    ...context,
    styles: { ...context.styles, variables: supportedVariables },
  };
}

/** Remove style keys the installed SDK schema cannot parse before it sees host context. */
export function filterUnsupportedHostStyleVariables(
  message: JSONRPCMessage,
): JSONRPCMessage {
  const record = message as unknown as Record<string, unknown>;

  if (isRecord(record.result) && "hostContext" in record.result) {
    return {
      ...record,
      result: {
        ...record.result,
        hostContext: filterHostContext(record.result.hostContext),
      },
    } as unknown as JSONRPCMessage;
  }

  if (
    record.method === "ui/notifications/host-context-changed" &&
    "params" in record
  ) {
    return {
      ...record,
      params: filterHostContext(record.params),
    } as unknown as JSONRPCMessage;
  }

  return message;
}

/** App-side transport that makes host style additions forward-compatible. */
export class HostContextCompatibilityTransport implements Transport {
  private readonly transport = new PostMessageTransport(
    window.parent,
    window.parent,
  );

  private messageHandler?: Transport["onmessage"];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  constructor() {
    this.transport.onclose = () => this.onclose?.();
    this.transport.onerror = (error) => this.onerror?.(error);

    this.transport.onmessage = (message, extra) =>
      this.messageHandler?.(
        filterUnsupportedHostStyleVariables(message),
        extra,
      );
  }

  get onmessage() {
    return this.messageHandler;
  }

  set onmessage(handler: Transport["onmessage"]) {
    this.messageHandler = handler;
  }

  async start() {
    await this.transport.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    await this.transport.send(message, options);
  }

  async close() {
    await this.transport.close();
  }
}
