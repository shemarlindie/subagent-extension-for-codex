import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  OpenAIMentionSearchParamsSchema,
  OpenAIMentionSearchResultSchema,
} from "@openai/mcp-extensions/server";
import { z } from "zod";

import { dataDirectory } from "../service/runtime.js";
import { productGlyphIcons } from "./product-glyph.js";

interface WorkerAvailability {
  provider: string;
  profiles: string[];
}

export const mentionSearchToolName = "search_mentions";

export const mentionSearchToolConfig = {
  title: "Choose a worker",
  inputSchema: OpenAIMentionSearchParamsSchema,
  outputSchema: OpenAIMentionSearchResultSchema,
  annotations: { readOnlyHint: true },
  _meta: {
    connector_name: "Delegate to Claude",
    "openai/extensions": { "mentions/search": {} },
    ui: { visibility: ["app"] },
  },
};

export const claudeMentionUri = "codex-subagent-extension://providers/claude";

export const mentionSearchSchema = z.strictObject({
  query: z.string().max(128),
});

export const claudeMentionResource = {
  description:
    "Selected Claude provider hint for delegated coding work. Use an available profile that matches the request; code reviews use reviewer. This does not select a repository or change permission settings.",
  mimeType: "text/plain",
};

export const mentionTestModeEnv = "CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE";

export const mentionSearchLogFilename = "mention-search.jsonl";

/** Local .env paths are relative to the package, while MCP environment paths keep cwd semantics. */
export function resolveMentionSearchEnv(
  environment: NodeJS.ProcessEnv,
  localEnvironment: NodeJS.ProcessEnv,
  packageRoot: string,
): NodeJS.ProcessEnv {
  const result = { ...environment };

  if (
    result[mentionTestModeEnv] === undefined &&
    localEnvironment[mentionTestModeEnv] !== undefined
  ) {
    result[mentionTestModeEnv] = localEnvironment[mentionTestModeEnv];
  }

  if (
    result.CODEX_SUBAGENT_EXTENSION_DATA === undefined &&
    localEnvironment.CODEX_SUBAGENT_EXTENSION_DATA
  ) {
    result.CODEX_SUBAGENT_EXTENSION_DATA = resolve(
      packageRoot,
      localEnvironment.CODEX_SUBAGENT_EXTENSION_DATA,
    );
  }

  return result;
}

const sampleDescription =
  "Test-only Claude mention sample. This does not confirm that a Claude provider is configured or start a task.";

// Include the server name because some hosts use the selected server mention
// as the initial typeahead query before forwarding the user's search text.
const mentionSearchTerms = [
  "claude",
  "provider",
  "reviewer",
  "delegate to claude",
  "work",
  "worker",
  "codex-subagent-extension",
];

function searchWords(value: string) {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Suggests a provider only; project and permission context stay separate. */
export async function searchAgentMentions(
  query: string,
  workers: readonly WorkerAvailability[],
  env: NodeJS.ProcessEnv = process.env,
) {
  const queryWords = searchWords(query);
  const testMode = env[mentionTestModeEnv] === "1";

  const claude = workers.some(
    (worker) =>
      worker.provider === "claude" && worker.profiles.includes("reviewer"),
  );

  const indexedWords = mentionSearchTerms.flatMap(searchWords);

  const matches = queryWords.every((queryWord) =>
    indexedWords.some((word) => word.startsWith(queryWord)),
  );

  const result = {
    items:
      testMode || (claude && matches)
        ? [
            {
              type: "resource_link" as const,
              uri: claudeMentionUri,
              name: "Claude",
              title: testMode ? "Claude (sample)" : "Claude",
              description: testMode
                ? sampleDescription
                : "Delegate coding, investigation, or review work to Claude.",
              icons: productGlyphIcons,
              mimeType: claudeMentionResource.mimeType,
            },
          ]
        : [],
  };

  if (testMode) {
    await logMentionSearch(
      query,
      workers,
      result.items.map((item) => item.name),
      env,
    );
  }

  return result;
}

export async function readClaudeMention(env: NodeJS.ProcessEnv = process.env) {
  return {
    contents: [
      {
        uri: claudeMentionUri,
        mimeType: claudeMentionResource.mimeType,
        text:
          env[mentionTestModeEnv] === "1"
            ? sampleDescription
            : claudeMentionResource.description,
      },
    ],
  };
}

async function logMentionSearch(
  query: string,
  workers: readonly WorkerAvailability[],
  resultNames: string[],
  env: NodeJS.ProcessEnv,
) {
  const directory = dataDirectory(env);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const log = await open(join(directory, mentionSearchLogFilename), "a", 0o600);

  try {
    await log.chmod(0o600);

    await log.appendFile(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        query,
        ...(workers.length
          ? { providers: workers.map((worker) => worker.provider) }
          : { providerCheckSkipped: true }),
        resultNames,
        testMode: true,
      })}\n`,
      "utf8",
    );
  } finally {
    await log.close();
  }
}
