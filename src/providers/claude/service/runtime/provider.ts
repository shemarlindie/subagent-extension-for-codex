import { randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  archiveSession,
  query,
  unarchiveSession,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { RunError } from "../../../../core/service/features/providers/run-error.js";
import {
  type Provider,
  type RunContext,
  type TurnOutput,
} from "../../../../core/service/features/providers/types.js";
import * as logger from "../../../../core/service/platform/logging/logger.js";
import {
  type ModelChoice,
  type ProviderReadiness,
} from "../../../../core/shared/providers/types.js";
import type { SettingsValues } from "../../../../core/shared/settings/settings-schema.js";
import { slashCommand } from "../../../../core/shared/tasks/conversation/commands.js";
import { type Task } from "../../../../core/shared/tasks/model.js";
import { claudeMetadata } from "../../shared/metadata.js";
import { claudeSettingsSchema } from "../../shared/settings.js";
import { ClaudeCli } from "../configuration/executable.js";
import type { SettingsReader } from "../configuration/session-settings.js";
import { claudeTaskPolicy } from "../configuration/task-policy.js";
import {
  claudeMessageNormalizer,
  localCommandOutput,
} from "../events/normalize.js";
import { ClaudeCommands } from "./command-discovery.js";
import { contextUsageRecorder } from "./context-usage.js";
import { ClaudeDiscovery } from "./discovery.js";
import { recordEffectiveSettings } from "./effective-settings.js";
import { Inbox } from "./inbox.js";
import { ClaudePlanUsage } from "./plan-usage.js";
import { recordPromptCache } from "./prompt-cache.js";
import {
  claudeSessionDeletionStatus,
  deleteClaudeSession,
} from "./session-cleanup.js";
import { claudeTurnOptions } from "./turn-options.js";

/**
 * The installed SDK's Query declaration omits controls supported by the CLI
 * runtime: an interrupt that also cancels queued messages, withdrawing one
 * queued message, and reading the session's settings.
 */
type SteerableQuery = Omit<Query, "interrupt"> & {
  interrupt(options?: { cancelQueued?: boolean }): Promise<unknown>;
  cancelAsyncMessage?(uuid: string): Promise<boolean>;
} & SettingsReader;

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
    slash_commands: true,
  };

  private discoveries = new Map<string, ClaudeDiscovery>();
  private commandLists: ClaudeCommands;
  readonly planUsage: ClaudePlanUsage;
  /** When the claude.ai sign-in ends, as the latest result reported it. */
  private credentialExpiresAt?: string;

  constructor(
    private launch: typeof query = query,
    private cli: Pick<ClaudeCli, "status" | "executable"> = new ClaudeCli(),
    private fullEvents = false,
  ) {
    this.commandLists = new ClaudeCommands(launch, cli);
    this.planUsage = new ClaudePlanUsage(launch, cli);
  }

  async readiness(options?: { refresh?: boolean }): Promise<ProviderReadiness> {
    const status = await this.cli.status(options);

    const details = {
      ...(!status.ready ? { problem: status.problem } : {}),
      ...(status.path ? { executable: status.path } : {}),
      ...(status.version ? { version: status.version } : {}),
      supported_versions: status.supported,
    };

    const credential = this.credentialExpiresAt
      ? { credential_expires_at: this.credentialExpiresAt }
      : {};

    return status.ready
      ? { ready: true, details, ...credential }
      : {
          ready: false,
          message: status.message,
          details,
          ...credential,
        };
  }

  async deleteSession(task: Task, expectedVersion?: string) {
    if (!task.session_id) return;

    await deleteClaudeSession(task, expectedVersion);
  }

  sessionDeletionStatus(task: Task) {
    return claudeSessionDeletionStatus(task);
  }

  /**
   * Sets or clears the session's archived mark, which `listSessions()`
   * reports. A later prompt in the session clears the mark.
   */
  async setSessionArchived(task: Task, archived: boolean) {
    const id = task.session_id;
    if (!id) return;

    // The SDK marks every transcript with the ID, so a copy in another
    // project folder, such as a linked worktree's, would change too.
    const paths = await sessionPaths(id);

    if (paths.length !== 1 || paths[0] !== task.session_state_ref) {
      throw new Error(
        `Claude session ${id} isn't only at its recorded location (${paths.length} found).`,
      );
    }

    await (archived ? archiveSession : unarchiveSession)(id);
  }

  models(
    settings?: SettingsValues,
    repository?: string,
  ): Promise<ModelChoice[]> {
    return this.discovery(settings, repository).models();
  }

  policy(settings?: SettingsValues, repository?: string) {
    return this.discovery(settings, repository).policy();
  }

  commands(task: Task) {
    return this.commandLists.list(task);
  }

  /**
   * One discovery per project folder and configuration, as both change what a
   * session loads.
   */
  private discovery(settings?: SettingsValues, repository?: string) {
    const configuration = {
      settings_files: claudeSettingsSchema.parse(settings?.providers.claude)
        .settings_files,
    };

    const key = JSON.stringify([repository, configuration.settings_files]);
    let discovery = this.discoveries.get(key);

    if (!discovery) {
      discovery = new ClaudeDiscovery(
        this.launch,
        this.cli,
        configuration,
        undefined,
        repository,
      );

      this.discoveries.set(key, discovery);
    }

    return discovery;
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
    const promptId = randomUUID();

    const normalize = claudeMessageNormalizer(this.fullEvents);
    const launched = performance.now();
    let firstEvent = true;
    let firstText = true;

    const stream = this.launch({
      prompt: inbox,
      options,
    }) as unknown as SteerableQuery & AsyncIterable<SDKMessage>;

    const contextUsage = contextUsageRecorder(c, stream);

    // Steers sent into the turn and not yet taken, by the uuid they went with.
    const steers = new Map<string, string>();
    // The final message is ending, so the turn takes no more steers.
    let ending = false;
    // A steer couldn't be withdrawn, so the CLI runs it after this result.
    // Widened because a callback sets it, which TypeScript can't see.
    let continuing = false as boolean;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    // The CLI has queued the prompt and not started it.
    let promptWaiting = false;

    const interrupt = () => {
      // Interrupting ends the turn with an interrupted result and keeps the
      // session; stopping the process is the fallback.
      fallback = setTimeout(() => abortController.abort(), INTERRUPT_GRACE_MS);

      Promise.resolve()
        .then(() => stream.interrupt({ cancelQueued: true }))
        .catch((error: unknown) => {
          logger.logError("provider.interrupt_fallback", error);
          abortController.abort();
        });
    };

    c.signal.addEventListener("abort", interrupt, { once: true });
    if (c.signal.aborted) interrupt();

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
    // What a command that ran in Claude Code printed, since its result.
    let localOutput: string | undefined;
    let commandOutput = false;
    // The main worker's message being streamed.
    let streaming: string | undefined;
    // A steer the CLI runs as its own turn starts again, in whatever mode
    // the first one left, so only the first start says what the task got.
    let started = false;
    // The session last reported and its transcript, once found.
    let sessionId: string | undefined;
    let sessionRef: string | undefined;

    try {
      // With no prompt sent, ending the input ends the session before any
      // model call, and whatever the CLI still has to say arrives below.
      if (c.signal.aborted) {
        c.promptHeld();
        inbox.end();
      } else {
        inbox.push({
          type: "user",
          message: { role: "user", content: prompt },
          parent_tool_use_id: null,
          session_id: "",
          uuid: promptId,
        });

        c.acceptSteers((steer) => {
          // The CLI would hold a command until the turn ends, then run it
          // as a turn of its own, so it waits for its own turn instead.
          if (ending || c.signal.aborted || slashCommand(steer.text)) {
            return false;
          }

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
      }

      for await (const m of stream) {
        if (firstEvent) {
          firstEvent = false;

          logger.logEvent("info", "provider.first_event", {
            duration_ms: performance.now() - launched,
          });
        }

        // A new session's transcript may not exist for its first messages,
        // so the lookup repeats until it finds one.
        if (
          "session_id" in m &&
          m.session_id &&
          (m.session_id !== sessionId || !sessionRef)
        ) {
          sessionId = m.session_id;
          sessionRef = await this.sessionPath(sessionId);

          c.session(sessionId, sessionRef);
        }

        if ((m as { type: string }).type === "command_lifecycle") {
          const { command_uuid, state } = m as unknown as CommandLifecycle;
          if (command_uuid === promptId) promptWaiting = state === "queued";
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
              recordPromptCache(c, "message_start", m.event.message.usage);
            } else if (
              m.event.type === "content_block_delta" &&
              m.event.delta.type === "text_delta" &&
              streaming
            ) {
              if (firstText && m.event.delta.text) {
                firstText = false;

                logger.logEvent("info", "provider.first_text", {
                  duration_ms: performance.now() - launched,
                });
              }

              c.delta(streaming, m.event.delta.text);
            } else if (m.event.type === "message_delta") {
              // The CLI has the response's usage from here on.
              contextUsage.measure();
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

        // Resuming after a turn that left a background command, the CLI reports
        // it stopped and gives a result before it starts the prompt. An error
        // still ends the turn, as the prompt may never start.
        if (
          promptWaiting &&
          m.type === "result" &&
          m.subtype === "success" &&
          !m.is_error
        ) {
          continue;
        }

        // Compaction's own request emits no stream events. Its note shows the
        // context size after it, as the context usage meter does.
        if (m.type === "system" && m.subtype === "compact_boundary") {
          recordPromptCache(c, "compact_boundary");
          const usage = await contextUsage.measureNow();

          normalize(
            c,
            m,
            usage && { context_tokens_after: usage.total_tokens },
          );
        } else {
          normalize(c, m);
        }

        this.planUsage.fromMessage(m, Boolean(options.settingSources?.length));
        localOutput = localCommandOutput(m) ?? localOutput;

        if (m.type === "system" && m.subtype === "init" && !started) {
          started = true;
          await recordEffectiveSettings(c, m, stream);
        }

        if (m.type !== "result") continue;

        const refusal =
          "startup_failure_reason" in m && m.startup_failure_reason
            ? m
            : undefined;

        // Absent for an API key, so a switch from claude.ai clears it. Only a
        // result the CLI numbered can report the sign-in, and a refusal ran no
        // requests, so other results keep the known date.
        if (m.result_index !== undefined && !refusal) {
          this.credentialExpiresAt = m.credential_expires_at;
        }

        logger.logEvent("info", "provider.result", {
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
          credential_expires_at: m.credential_expires_at,
        });

        // Claude Code refused to start, and its own text names the fix.
        if (refusal) {
          logger.logEvent("warn", "provider.startup_refused", {
            reason: refusal.startup_failure_reason,
          });

          throw new Error(refusal.errors.join("; "));
        }

        if (m.subtype !== "success") {
          throw new RunError(
            m.subtype === "error_max_budget_usd"
              ? "cost_budget_exhausted"
              : m.subtype,
            m.errors.join("; "),
          );
        }

        // Its text is the error here, such as an invalid API key.
        if (m.is_error) {
          throw new Error(
            m.result || "Claude reported an error with no message",
          );
        }

        // A command such as /compact gives its output and an empty result.
        commandOutput = !m.result && localOutput !== undefined;
        reply = m.result || localOutput || "";
        localOutput = undefined;

        if (continuing) {
          continuing = false;
          continue;
        }

        // Leaving the loop closes the query, which fails a measurement still
        // running.
        await contextUsage.settle();

        // Closing here drops session_writes_lost, which the CLI sends as it
        // exits. Waiting for the exit would add about 0.7s to every turn.
        break;
      }

      if (reply === undefined) throw new Error("Claude ended without a result");

      return commandOutput ? { reply, commandOutput } : { reply };
    } finally {
      clearTimeout(fallback);
      c.signal.removeEventListener("abort", interrupt);
      inbox.end();
      stream.close();
      // The turn's requests count against the plan.
      this.planUsage.refresh(Boolean(options.settingSources?.length));
    }
  }

  async sessionPath(id: string) {
    return (await sessionPaths(id))[0];
  }
}

/** The real path of each project folder's transcript with this session ID. */
async function sessionPaths(id: string) {
  const root = join(
    (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize(
      "NFC",
    ),
    "projects",
  );

  const paths: string[] = [];

  try {
    for (const d of await readdir(root)) {
      try {
        paths.push(await realpath(join(root, d, `${id}.jsonl`)));
      } catch {}
    }
  } catch {}

  return paths;
}
