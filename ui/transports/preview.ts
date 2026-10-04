import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { previewTool } from "./preview-tools";
import type { Transport, TransportEvents } from "../core/types";

export class PreviewTransport implements Transport {
  readonly embedded = false;
  readonly preview = true;
  async connect(_events: TransportEvents) {
    applyDocumentTheme(
      new URLSearchParams(location.search).get("theme") === "dark"
        ? "dark"
        : "light",
    );
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return previewTool(name, args) as T;
  }

  watch() {}
  dispose() {}
}
