import { randomUUID } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  deleteSession,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { claudeOverrideDefaults } from "../../../../../shared/providers/claude/permissions.js";
import { claudeMetadata } from "../../../../../shared/providers/metadata.js";
import {
  type ModelChoice,
  type ProviderReadiness,
} from "../../../../../shared/providers/types.js";
import type { SettingsValues } from "../../../../../shared/settings/settings-schema.js";
import { type Task } from "../../../../../shared/tasks/model.js";
import { logError, logEvent } from "../../../../platform/logging/logger.js";
import {
  type Provider,
  type RunContext,
  type TurnOutput,
} from "../../types.js";
import { ClaudeCli } from "../configuration/executable.js";
import { claudeTaskPolicy } from "../configuration/task-policy.js";
import { claudeMessageNormalizer } from "../events/normalize.js";
import { Inbox } from "./inbox.js";
import { ModelCatalog } from "./models.js";
import { claudeTurnOptions } from "./turn-options.js";

/**
 * The installed SDK's Query declaration omits two controls supported by the
 * CLI runtime: an interrupt that also cancels queued messages, and withdrawing
 * one queued message.
 */
type SteerableQuery = Omit<Query, "interrupt"> & {
  interrupt(options?: { cancelQueued?: boolean }): Promise<unknown>;
  cancelAsyncMessage?(uuid: string): Promise<boolean>;
};

/**
 * A frame the CLI sends that the SDK doesn't declare: where a message sent
 * while a turn runs has got to. `started` means the turn took it.
 */
type CommandLifecycle = {
  type: "command_lifecycle";
  command_uuid: string;
  state: "queued" | "started" | "completed" | "cancelled";
};

/** How long an interrupt may take before the process is stopped instead. */
const INTERRUPT_GRACE_MS = 10_000;

export class ClaudeAgentProvider implements Provider {
  id = "claude";
  taskPolicy = claudeTaskPolicy;
  metadata = claudeMetadata;
  capabilities = {
    interrupt: true,
    session_continue: true,
    session_state_portable: false,
    interactive_input: true,
    worktree: true,
    cost_budget: true,
    runtime_budget: true,
    token_budget: false,
    // Settings can turn subagents off per user.
    subagents: true,
    parallel_subagents: true,
    dynamic_subagents: false,
  };

  private catalogs = new Map<string, ModelCatalog>();

  constructor(
    private launch: typeof query = query,
    private removeSession: typeof deleteSession = deleteSession,
    private cli: Pick<ClaudeCli, "status" | "executable"> = new ClaudeCli(),
    private fullEvents = false,
  ) {}

  async readiness(): Promise<ProviderReadiness> {
    const status = await this.cli.status();

    const details = {
      ...(status.path ? { executable: status.path } : {}),
      ...(status.version ? { version: status.version } : {}),
      supported_versions: status.supported,
    };

    return status.ready
      ? { ready: true, details }
      : { ready: false, message: status.message, details };
  }

  async deleteSession(task: Task) {
    if (!task.session_id) return;

    try {
      await this.removeSession(task.session_id);
    } catch (error) {
      // The SDK reports absence with this message; filesystem/cleanup failures
      // must propagate even when it already removed the main transcript.
      if (
        !(error instanceof Error) ||
        error.message !==
          `Session ${task.session_id} not found in any project directory`
      ) {
        throw error;
      }
    }
  }

  models(settings?: SettingsValues): Promise<ModelChoice[]> {
    const claude = settings?.providers.claude;

    const configuration = {
      settings_files:
        claude?.settings_files ?? claudeOverrideDefaults.settings_files,
    };

    const key = JSON.stringify(configuration);
    let catalog = this.catalogs.get(key);

    if (!catalog) {
      catalog = new ModelCatalog(this.launch, this.cli, configuration);
      this.catalogs.set(key, catalog);
    }

    return catalog.models();
  }

  async run(c: RunContext, prompt: string): Promise<TurnOutput> {
    // Stops the process: only when an interrupt doesn't end the turn.
    const abortController = new AbortController();

    const options = await claudeTurnOptions(
      c,
      await this.cli.executable(),
      abortController,
    );

    // Streaming input mode, so steers can follow the prompt while it runs.
    const inbox = new Inbox<SDKUserMessage>();

    inbox.push({
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
      session_id: "",
    });

    const normalize = claudeMessageNormalizer(this.fullEvents);
    const launched = performance.now();
    let firstEvent = true;
    let firstText = true;

    const stream = this.launch({
      prompt: inbox,
      options,
    }) as unknown as SteerableQuery & AsyncIterable<SDKMessage>;

    // Steers sent into the turn and not yet taken, by the uuid they went with.
    const steers = new Map<string, string>();
    // The final message is ending, so the turn takes no more steers.
    let ending = false;
    // A steer couldn't be withdrawn, so the CLI runs it after this result.
    // Widened because a callback sets it, which TypeScript can't see.
    let continuing = false as boolean;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    // A background command's notice arrived, so an empty result can follow.
    let backgroundNotice = false;

    const interrupt = () => {
      // Interrupting ends the turn with an interrupted result and keeps the
      // session; stopping the process is the fallback.
      fallback = setTimeout(() => abortController.abort(), INTERRUPT_GRACE_MS);

      Promise.resolve()
        .then(() => stream.interrupt({ cancelQueued: true }))
        .catch((error: unknown) => {
          logError("provider.interrupt_fallback", error);
          abortController.abort();
        });
    };

    c.signal.addEventListener("abort", interrupt, { once: true });
    if (c.signal.aborted) interrupt();

    c.acceptSteers((steer) => {
      if (ending || c.signal.aborted) return false;
      const uuid = randomUUID();
      steers.set(uuid, steer.id);

      inbox.push({
        type: "user",
        message: { role: "user", content: steer.text },
        parent_tool_use_id: null,
        session_id: "",
        priority: "next",
        uuid,
      });

      return true;
    });

    // The CLI runs a steer the turn ends without taking as a turn of its
    // own, so each one is withdrawn as the final message ends; one already
    // on its way runs, and this turn waits for it.
    const withdraw = async () => {
      ending = true;

      for (const uuid of [...steers.keys()]) {
        const withdrawn = await stream
          .cancelAsyncMessage?.(uuid)
          .catch(() => false);

        if (withdrawn) steers.delete(uuid);
        else continuing = true;
      }
    };

    let reply: string | undefined;
    // The main worker's message being streamed.
    let streaming: string | undefined;

    try {
      for await (const m of stream) {
        if (firstEvent) {
          firstEvent = false;

          logEvent("info", "provider.first_event", {
            duration_ms: performance.now() - launched,
          });
        }

        if ("session_id" in m && m.session_id) {
          const ref = await this.sessionPath(m.session_id, c.task.workspace!);

          c.session(m.session_id, ref);
        }

        if ((m as { type: string }).type === "command_lifecycle") {
          const { command_uuid, state } = m as unknown as CommandLifecycle;
          const id = steers.get(command_uuid);

          if (id && state === "started") {
            steers.delete(command_uuid);
            c.steerTaken(id);
            // A steer the CLI runs as its own turn can take more.
            ending = false;
          }

          continue;
        }

        if (m.type === "stream_event") {
          // The main worker's text streams as deltas; other frames are
          // left out, and the finished message follows.
          if (m.parent_tool_use_id === null) {
            if (m.event.type === "message_start") {
              streaming = m.event.message.id;
            } else if (
              m.event.type === "content_block_delta" &&
              m.event.delta.type === "text_delta" &&
              streaming
            ) {
              if (firstText && m.event.delta.text) {
                firstText = false;

                logEvent("info", "provider.first_text", {
                  duration_ms: performance.now() - launched,
                });
              }

              c.delta(streaming, m.event.delta.text);
            }
          }

          const stop =
            m.parent_tool_use_id === null &&
            m.event.type === "message_delta" &&
            m.event.delta.stop_reason;

          if (stop && stop !== "tool_use" && stop !== "pause_turn") {
            await withdraw();
          }

          continue;
        }

        if (m.type === "system" && m.subtype === "task_notification") {
          backgroundNotice = true;
        }

        // Resuming after a turn that left a background command, the CLI reports
        // it stopped and gives a result with no turns before it runs the prompt.
        if (
          backgroundNotice &&
          m.type === "result" &&
          m.subtype === "success" &&
          !m.is_error &&
          m.num_turns === 0 &&
          !m.result
        ) {
          continue;
        }

        normalize(c, m);
        if (m.type !== "result") continue;

        logEvent("info", "provider.result", {
          subtype: m.subtype,
          is_error: m.is_error,
          duration_ms: performance.now() - launched,
          api_duration_ms: m.duration_api_ms,
          input_tokens: m.usage.input_tokens,
          output_tokens: m.usage.output_tokens,
          cache_read_tokens: m.usage.cache_read_input_tokens,
          cache_creation_tokens: m.usage.cache_creation_input_tokens,
          cost_usd: m.total_cost_usd,
          turn_count: m.num_turns,
        });

        if (m.subtype !== "success" || m.is_error) {
          throw new Error(
            `Claude result: ${m.subtype}${"errors" in m ? ": " + m.errors.join("; ") : ""}`,
          );
        }

        reply = m.result;

        if (continuing) {
          continuing = false;
          continue;
        }

        break;
      }

      if (reply === undefined) throw new Error("Claude ended without a result");

      return { reply };
    } finally {
      clearTimeout(fallback);
      c.signal.removeEventListener("abort", interrupt);
      inbox.end();
      stream.close();
    }
  }

  async sessionPath(id: string, workspace: string) {
    const root = join(
      process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
      "projects",
    );

    try {
      for (const d of await readdir(root)) {
        const p = join(root, d, `${id}.jsonl`);

        try {
          await access(p);

          return p;
        } catch {}
      }
    } catch {}

    return join(root, workspace.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`);
  }
}
