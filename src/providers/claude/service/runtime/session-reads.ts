import {
  query,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { logError } from "../../../../core/service/platform/logging/logger.js";
import { claudeEnvironment } from "../configuration/execution-environment.js";
import {
  READ_TIMEOUT_MS,
  type SettingsReader,
} from "../configuration/session-settings.js";

/**
 * Starts the native harness without submitting a turn or granting tools, to
 * read what a task's session would offer. It loads settings as a task does,
 * without running their hooks or MCP servers. `timeout` rejects and stops the
 * process when Claude Code is slower than a task would wait. Close it after
 * reading.
 */
export function turnlessSession(
  launch: typeof query,
  settingsFiles: boolean,
  options: Options,
) {
  const abortController = new AbortController();
  let release!: () => void;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  // eslint-disable-next-line require-yield -- an open prompt stream that never sends a turn
  const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
    await pending;
  })();

  const session = launch({
    prompt,
    options: {
      // Match the task environment and the user's settings-file policy.
      env: claudeEnvironment(process.env),
      abortController,
      persistSession: false,
      settingSources: settingsFiles ? ["user", "project", "local"] : [],
      // Reading must not run the user's settings-file hooks on every refresh.
      settings: { disableAllHooks: true },
      strictMcpConfig: true,
      mcpServers: {},
      tools: [],
      ...options,
    },
  }) as Query & SettingsReader;

  // Claude Code answers only once its org policy fetch settles, so this
  // waits as long as a task would.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      reject(new Error("Claude Code didn't answer in time"));
    }, READ_TIMEOUT_MS);
  });

  return {
    session,
    timeout,
    close() {
      clearTimeout(timer);
      release();
      session.close();
    },
  };
}

/** How long a successful read is kept. */
export const READ_CACHE_MS = 5 * 60 * 1000;

/**
 * A read that runs once at a time and keeps its result until it expires. A
 * failure is remembered for 30 seconds, so polling doesn't relaunch a broken
 * runtime on every request.
 */
export class CachedRead<T> {
  private value?: { result: T; expires: number };
  private request?: Promise<T>;
  private failure?: { expires: number; error: Error };

  constructor(
    private read: () => Promise<{ result: T; expires: number }>,
    private failureEvent: string,
  ) {}

  get(): Promise<T> {
    if (this.value && this.value.expires > Date.now()) {
      return Promise.resolve(this.value.result);
    }

    if (this.request) return this.request;

    if (this.failure && this.failure.expires > Date.now()) {
      return Promise.reject(this.failure.error);
    }

    const request = this.read().then(
      (value) => {
        this.value = value;
        this.failure = undefined;

        return value.result;
      },
      (error: unknown) => {
        this.failure = {
          expires: Date.now() + 30000,
          error: error instanceof Error ? error : new Error(String(error)),
        };

        throw error;
      },
    );

    this.request = request;

    void request
      .finally(() => {
        this.request = undefined;
      })
      .catch((error: unknown) => {
        logError(this.failureEvent, error);
      });

    return request;
  }
}
