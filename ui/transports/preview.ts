import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";

import type { Transport, TransportEvents } from "../core/types";
import { previewTool } from "./preview-tools";

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
