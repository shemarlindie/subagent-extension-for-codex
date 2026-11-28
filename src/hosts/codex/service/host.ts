import type {
  OpenAIUiResourceMetadata,
  OpenAIUiToolMetadata,
} from "@openai/mcp-extensions/server";

import type { HostAdapter } from "../../../core/service/platform/host/host-adapter.js";
import {
  tool,
  type AnyTool,
} from "../../../core/service/platform/server/tools/definition.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import {
  claudeMentionResource,
  claudeMentionUri,
  composerMentionsEnabled,
  mentionSearchSchema,
  mentionSearchToolConfig,
  mentionSearchToolName,
  readClaudeMention,
  searchAgentMentions,
} from "./mentions.js";

/** Codex: directory and conversation hints, the panel's entrypoints and mentions. */
export const codexHost: HostAdapter = {
  // Opts in to sandbox metadata, verified in the public rust-v0.160.0 source.
  capabilities: { experimental: { "codex/sandbox-state-meta": {} } },
  instructions: SERVER_INSTRUCTIONS,
  hints(meta) {
    const state = meta?.["codex/sandbox-state-meta"] as
      { sandboxCwd?: unknown } | undefined;

    // Codex core adds threadId. ChatGPT documents its anonymized session field.
    const session = meta?.["openai/session"] ?? meta?.threadId;

    return {
      ...(typeof state?.sandboxCwd === "string"
        ? { directory: state.sandboxCwd }
        : {}),
      ...(typeof session === "string" ? { conversation: session } : {}),
    };
  },
  panel: {
    name: "open_subagent_extension_for_codex",
    globalName: "app_open_subagent_extension_for_codex_global",
    // Bump the URI when resource metadata or the panel's tool calls change, to
    // invalidate host caches.
    uri: "ui://subagent-extension-for-codex/app-v8",
    toolMeta: {
      "openai/ui": {
        entrypoints: [{ type: "thread" }],
        preferredModelDisplayMode: "inline",
      } satisfies OpenAIUiToolMetadata,
    },
    globalToolMeta: {
      "openai/ui": {
        entrypoints: [{ type: "global" }],
        preferredModelDisplayMode: "inline",
      } satisfies OpenAIUiToolMetadata,
    },
    resourceMeta: {
      "openai/ui": {
        availableDisplayModes: ["inline", "fullscreen"],
        preferredDisplayMode: "inline",
      } satisfies OpenAIUiResourceMetadata,
      "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
    },
    taskToolMeta: { "openai/ui": { preferredModelDisplayMode: "inline" } },
  },
  tools({ c }): Record<string, AnyTool> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Temporary feature gate.
    if (!composerMentionsEnabled) return {};

    return {
      // The composer calls this. The stdio proxy and `register` list it
      // with the mention extension metadata.
      [mentionSearchToolName]: tool({
        readOnly: true,
        description:
          "Search for the configured Claude provider in the composer mention picker.",
        schema: mentionSearchSchema,
        run: ({ query }) => searchAgentMentions(query, c.workers()),
      }),
    };
  },
  register(server, c) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Temporary feature gate.
    if (!composerMentionsEnabled) return;

    server.registerTool(
      mentionSearchToolName,
      mentionSearchToolConfig,
      async ({ query }) => ({
        content: [],
        structuredContent: await searchAgentMentions(query, c.workers()),
      }),
    );

    server.registerResource(
      "Claude provider mention",
      claudeMentionUri,
      claudeMentionResource,
      () => readClaudeMention(),
    );
  },
};
