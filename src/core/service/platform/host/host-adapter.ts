import type {
  McpServer,
  ServerCapabilities,
} from "@modelcontextprotocol/server";

import { maxPathLength } from "../../../shared/filesystem/path-limit.js";
import type { Control } from "../../features/tasks/runtime/control.js";
import type { AnyTool, ToolContext } from "../server/tools/definition.js";

/**
 * Chat context a host attaches to an MCP call. Hints correlate and suggest,
 * and never grant access.
 */
export interface HostHints {
  /**
   * The chat's working directory as a local `file:` URI. Within the path limit
   * once read through `readHints` or `boundedDirectory`.
   */
  directory?: string;
  /** The host's chat or session identifier. */
  conversation?: string;
}

/** The panel's entrypoints and the host metadata merged into each. */
export interface HostPanel {
  /** The tool that opens the panel beside a chat. */
  name: string;
  /** The app-only tool that opens the panel across all projects. */
  globalName: string;
  /** The panel resource. Changing it invalidates host caches. */
  uri: string;
  toolMeta: Record<string, unknown>;
  globalToolMeta: Record<string, unknown>;
  resourceMeta: Record<string, unknown>;
  /** Metadata for task tools that open the panel. */
  taskToolMeta: Record<string, unknown>;
}

/** What a host supplies to the MCP servers that serve it. */
export interface HostAdapter {
  /** MCP server capabilities beyond tools. */
  capabilities: Pick<ServerCapabilities, "experimental">;
  instructions: string;
  /** Reads the hints from a request's metadata. Callers use `readHints`. */
  hints(meta: Record<string, unknown> | undefined): HostHints;
  panel: HostPanel;
  /** App-only tools the host adds to the tool API. */
  tools(context: ToolContext): Record<string, AnyTool>;
  /** Registers the host's own tools and resources on the service's MCP server. */
  register(server: McpServer, c: Control): void;
}

/**
 * A directory hint, or nothing when it is longer than the path limit. Every
 * entry point passes the hint through this, so later code can trust its
 * length.
 */
export function boundedDirectory(directory?: string) {
  return directory !== undefined && directory.length <= maxPathLength
    ? directory
    : undefined;
}

/** Reads a request's hints from the host, dropping an over-long directory. */
export function readHints(
  host: HostAdapter,
  meta: Record<string, unknown> | undefined,
): HostHints {
  const { directory, ...hints } = host.hints(meta);
  const bounded = boundedDirectory(directory);

  return bounded === undefined ? hints : { ...hints, directory: bounded };
}
