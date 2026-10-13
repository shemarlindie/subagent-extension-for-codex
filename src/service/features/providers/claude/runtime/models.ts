import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { claudeOverrideDefaults } from "../../../../../shared/providers/claude/permissions.js";
import type { ModelChoice } from "../../../../../shared/providers/types.js";
import type { ClaudeCli } from "../configuration/executable.js";
import { claudeEnvironment } from "../configuration/execution-environment.js";

/**
 * The models the installed Claude Code offers, read by starting the native
 * harness without a turn. Polling reads the cache; a failure is remembered
 * briefly so a broken runtime isn't relaunched on every read.
 */
export class ModelCatalog {
  private catalog?: { expires: number; models: ModelChoice[] };
  private catalogRequest?: Promise<ModelChoice[]>;
  private catalogFailure?: { expires: number; error: Error };

  constructor(
    private launch: typeof query,
    private cli: Pick<ClaudeCli, "executable">,
  ) {}

  /** The models the CLI offers, cached briefly; a failed discovery is not retried at once. */
  models(): Promise<ModelChoice[]> {
    if (this.catalog && this.catalog.expires > Date.now()) {
      return Promise.resolve(this.catalog.models);
    }

    if (this.catalogRequest) return this.catalogRequest;

    if (this.catalogFailure && this.catalogFailure.expires > Date.now()) {
      return Promise.reject(this.catalogFailure.error);
    }

    const request = this.discoverModels();
    this.catalogRequest = request;

    void request
      .finally(() => {
        this.catalogRequest = undefined;
      })
      .catch(() => {});

    return request;
  }

  private async discoverModels(): Promise<ModelChoice[]> {
    const pathToClaudeCodeExecutable = await this.cli.executable();
    const abortController = new AbortController();
    let release!: () => void;

    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Initialize the native harness without submitting a user turn or granting tools.
    // eslint-disable-next-line require-yield -- an open prompt stream that never sends a turn
    const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
      await pending;
    })();

    const session = this.launch({
      prompt,
      options: {
        pathToClaudeCodeExecutable,
        // Match the default task environment so discovery sees the same provider configuration.
        env: claudeEnvironment(
          process.env,
          claudeOverrideDefaults.claude_environment,
        ),
        abortController,
        persistSession: false,
        settingSources: ["user", "project", "local"],
        // Model listing must not run the user's settings-file hooks on every refresh.
        settings: { disableAllHooks: true },
        strictMcpConfig: true,
        mcpServers: {},
        tools: [],
        permissionMode: "default",
        canUseTool: async () => ({
          behavior: "deny",
          message: "Model discovery cannot execute tools",
        }),
      },
    });

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new Error("Claude model discovery timed out"));
        }, 10000);
      });

      const models = await Promise.race([session.supportedModels(), timeout]);
      this.catalog = { models, expires: Date.now() + 5 * 60 * 1000 };
      this.catalogFailure = undefined;

      return models;
    } catch (error) {
      // Polling must not repeatedly launch a failing harness.
      this.catalogFailure = {
        expires: Date.now() + 30000,
        error: error instanceof Error ? error : new Error(String(error)),
      };

      throw error;
    } finally {
      clearTimeout(timer);
      release();
      session.close();
    }
  }
}
