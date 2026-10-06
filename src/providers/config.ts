import { isAbsolute, join } from "node:path";

import OpenAI from "openai";

import type { Provider } from "../core/model.js";
import type { Store } from "../core/store.js";
import { ClaudeAgentProvider } from "./claude.js";
import { CodexAgentProvider } from "./codex.js";
import { CodexExecutors } from "./codex-executors.js";
import { CodexSessions } from "./codex-session.js";
import { ExecutorJournal } from "./executor-journal.js";
import { MacExecutor } from "./mac-executor.js";

/** Explicit opt-in; constructing a provider does not make API requests. */
export function configuredProviders(
  store: Store,
  data: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const mode = env.CODEX_SUBAGENT_EXTENSION_PROVIDER;
  if (mode && !["claude", "codex"].includes(mode))
    throw new Error(
      "CODEX_SUBAGENT_EXTENSION_PROVIDER must be claude or codex",
    );
  const providers = new Map<string, Provider>();
  if (mode !== "codex") providers.set("claude", new ClaudeAgentProvider());

  if (env.CODEX_SUBAGENT_EXTENSION_CODEX === "1" || mode === "codex") {
    if (process.platform !== "darwin")
      throw new Error("The configured Codex executor requires macOS");
    const model = env.CODEX_SUBAGENT_EXTENSION_CODEX_MODEL;
    const executable = env.CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE;
    if (!model?.trim())
      throw new Error("Set CODEX_SUBAGENT_EXTENSION_CODEX_MODEL explicitly");
    if (!executable || !isAbsolute(executable))
      throw new Error(
        "Set CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE to the absolute native Codex executable path",
      );
    if (!env.OPENAI_API_KEY || !env.OPENAI_EXECUTOR_API_KEY)
      throw new Error(
        "Codex requires separate OPENAI_API_KEY and restricted OPENAI_EXECUTOR_API_KEY credentials",
      );
    if (env.OPENAI_API_KEY === env.OPENAI_EXECUTOR_API_KEY)
      throw new Error(
        "The application key must not be reused as the executor key",
      );

    const sessions = new CodexSessions(
      new OpenAI({ apiKey: env.OPENAI_API_KEY }),
      model,
    );

    const executors = new CodexExecutors(
      new MacExecutor(
        executable,
        join(data, "codex-runtime"),
        env.OPENAI_EXECUTOR_API_KEY,
        new ExecutorJournal(store),
      ),
    );

    providers.set("codex", new CodexAgentProvider(sessions, executors));
  }

  return providers;
}
