import { randomUUID } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  deleteSession,
  type Options,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import {
  claudeOverrideDefaults,
  readOnlyProfile,
} from "../../../../../shared/providers/claude/permissions.js";
import { readClaudeTaskOptions } from "../../../../../shared/providers/claude/task-options.js";
import { claudeMetadata } from "../../../../../shared/providers/metadata.js";
import {
  type ModelChoice,
  type ProviderReadiness,
} from "../../../../../shared/providers/types.js";
import { type Task } from "../../../../../shared/tasks/model.js";
import {
  type Provider,
  type RunContext,
  type TurnOutput,
} from "../../types.js";
import { ClaudeCli } from "../configuration/executable.js";
import {
  claudeEnvironment,
  claudeSandbox,
} from "../configuration/execution-environment.js";
import { claudeTaskPolicy } from "../configuration/task-policy.js";
import {
  approvalTool,
  inWorkspace,
  pathTools,
  readTools,
  toolPath,
  writeTools,
} from "../configuration/tool-policy.js";
import { claudeActivityPresentation } from "../events/activity.js";
import { Inbox } from "./inbox.js";
import { PARENT_TOOL, parentEnvironment, parentServer } from "./parent-tool.js";

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

/** The reason shown when a permission prompt is denied without a message. */
function defaultDenialMessage(tool: string) {
  if (tool === "Bash") return "Command denied";

  return writeTools.includes(tool) ? "Edit denied" : "Tool call denied";
}

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

  private catalog?: { expires: number; models: ModelChoice[] };
  private catalogRequest?: Promise<ModelChoice[]>;
  private catalogFailure?: { expires: number; error: Error };
  constructor(
    private launch: typeof query = query,
    private removeSession: typeof deleteSession = deleteSession,
    private cli: Pick<ClaudeCli, "status" | "executable"> = new ClaudeCli(),
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

  async run(c: RunContext, prompt: string): Promise<TurnOutput> {
    const taskOptions = readClaudeTaskOptions(c.task);

    if (
      !taskOptions.claude_policy ||
      !taskOptions.permission_mode ||
      !taskOptions.approval_decider
    ) {
      throw new Error(
        "Claude task is missing resolved native permission state",
      );
    }

    const policy = taskOptions.claude_policy;
    const nativeMode = taskOptions.permission_mode;

    const workspace = c.task.workspace!;
    // Stops the process: only when an interrupt doesn't end the turn.
    const abortController = new AbortController();
    const restricted = policy.tools === "restricted";

    const readOnly =
      restricted &&
      (readOnlyProfile(c.task.worker_profile) || nativeMode === "plan");

    const guarded = (tool: string) =>
      policy.path_guard && pathTools.includes(tool);

    // Restricted workers retain parent reporting alongside permitted task tools.
    const restrictedDenial = (tool: string) => {
      if (
        !restricted ||
        tool === PARENT_TOOL ||
        tool === "AskUserQuestion" ||
        tool === "Skill" ||
        readTools.includes(tool)
      ) {
        return undefined;
      }

      if (readOnly) return "Read-only worker profile";

      return approvalTool(tool) || writeTools.includes(tool)
        ? undefined
        : "Tool not permitted";
    };

    const sandbox =
      policy.sandbox === "user_config"
        ? {}
        : {
            sandbox: await claudeSandbox(c.task),
            ...(policy.sandbox === "extension_locked"
              ? {
                  // Policy-tier lock: settings files cannot add network domains.
                  managedSettings: {
                    sandbox: { network: { allowManagedDomainsOnly: true } },
                  },
                }
              : {}),
          };

    const options: Options = {
      pathToClaudeCodeExecutable: await this.cli.executable(),
      cwd: workspace,
      ...(c.task.model ? { model: c.task.model } : {}),
      ...(c.task.reasoning_effort && c.task.reasoning_effort !== "default"
        ? { effort: c.task.reasoning_effort as Options["effort"] }
        : {}),
      env: claudeEnvironment(process.env, policy.environment),
      ...sandbox,
      abortController,
      persistSession: true,
      resume: c.task.session_id,
      // Stream frames carry the reply as it's written, and show when the
      // final message ends, the last moment a steer the turn won't take can
      // be withdrawn.
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      permissionMode: nativeMode,
      ...(nativeMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      tools: restricted
        ? [
            ...readTools,
            ...(readOnly ? [] : [...writeTools, "Bash"]),
            "AskUserQuestion",
            "Skill",
          ]
        : { type: "preset", preset: "claude_code" },
      mcpServers: { codex_parent: parentServer(c) },
      allowedTools: [PARENT_TOOL],
      disallowedTools: policy.subagents ? [] : ["Agent", "Task"],
      ...(c.task.budget.max_cost_usd === null
        ? {}
        : {
            maxBudgetUsd: c.task.budget.max_cost_usd - (c.task.cost_usd ?? 0),
          }),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `${parentEnvironment(c)}\n\nYou are an independent ${c.task.worker_profile}. Work only in the provided task workspace. End each turn with a plain reply that says what you did, what you found and what is left. ${readOnly ? "Inspect only; you cannot edit files or run shell commands." : "Follow the configured native permission mode for tool execution."} ${c.task.workspace_strategy === "current_repo" ? "This is the current repository; preserve unrelated uncommitted changes. Write profiles edit the user checkout directly." : "Never modify the primary checkout."}`,
      },
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name !== "PreToolUse") return {};
                const tool = input.tool_name;
                const params = input.tool_input as Record<string, unknown>;

                const deny = (reason: string) => ({
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    permissionDecision: "deny" as const,
                    permissionDecisionReason: reason,
                  },
                });

                // Enabled restrictions deny before settings rules or modes can approve.
                // Skills stay available; the tools they call are checked individually.
                const denial = restrictedDenial(tool);
                if (denial) return deny(denial);

                if (
                  guarded(tool) &&
                  !(await inWorkspace(workspace, toolPath(params, workspace)))
                ) {
                  return deny("Path outside task workspace or Git metadata");
                }

                return {};
              },
            ],
          },
        ],
      },
      canUseTool: async (tool, input, { signal }) => {
        if (tool === PARENT_TOOL) {
          return { behavior: "allow", updatedInput: input };
        }

        if (tool === "AskUserQuestion") {
          const answer = await c.input(tool, input, signal);

          return answer.approved
            ? { behavior: "allow", updatedInput: { ...input, ...answer.input } }
            : { behavior: "deny", message: answer.message ?? "User declined" };
        }

        const denial = restrictedDenial(tool);
        if (denial) return { behavior: "deny", message: denial };

        if (guarded(tool)) {
          if (!(await inWorkspace(workspace, toolPath(input, workspace)))) {
            return { behavior: "deny", message: "Path outside task workspace" };
          }

          // Guarded reads stay inside the workspace, so they need no prompt.
          if (readTools.includes(tool)) {
            return { behavior: "allow", updatedInput: input };
          }
        }

        // Calls not already approved by settings or the permission mode ask the task's approver.
        const answer = await c.input(tool, input, signal);

        return answer.approved
          ? { behavior: "allow", updatedInput: input }
          : {
              behavior: "deny",
              message: answer.message ?? defaultDenialMessage(tool),
            };
      },
    };

    // Streaming input mode, so steers can follow the prompt while it runs.
    const inbox = new Inbox<SDKUserMessage>();

    inbox.push({
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
      session_id: "",
    });

    const stream = this.launch({
      prompt: inbox,
      options,
    }) as unknown as SteerableQuery & AsyncIterable<SDKMessage>;

    // Steers sent into the turn and not yet taken, by the uuid they went with.
    const steers = new Map<string, string>();
    // The final message is ending, so the turn takes no more steers.
    let ending = false;
    // A steer couldn't be withdrawn, so the CLI runs it after this result.
    let continuing = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;

    const interrupt = () => {
      // Interrupting ends the turn with an interrupted result and keeps the
      // session; stopping the process is the fallback.
      fallback = setTimeout(() => abortController.abort(), INTERRUPT_GRACE_MS);

      Promise.resolve()
        .then(() => stream.interrupt({ cancelQueued: true }))
        .catch(() => abortController.abort());
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

        this.normalize(c, m);
        if (m.type !== "result") continue;

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

  normalize(c: RunContext, m: SDKMessage) {
    // Keep the complete wire response on every derived activity, including
    // unknown SDK variants, so normalization never discards diagnostic context.
    const emit = (type: string, data: Record<string, unknown>) => {
      const payload = { ...data, raw_response: m };
      const activity = claudeActivityPresentation({ type, data: payload });
      c.emit(type, { ...payload, activity });
    };

    if (m.type === "assistant" || m.type === "user") {
      const content = m.message.content;

      if (typeof content === "string") {
        emit(m.type === "assistant" ? "agent.message" : "agent.content", {
          role: m.type,
          content,
          text: content,
        });
      } else {
        for (const b of content) {
          if (b.type === "text") {
            emit(m.type === "assistant" ? "agent.message" : "agent.content", {
              role: m.type,
              text: b.text,
              content: b,
            });
          } else if (b.type === "tool_use") {
            emit("tool.started", { id: b.id, name: b.name, input: b.input });
          } else if (b.type === "tool_result") {
            emit("tool.completed", {
              id: b.tool_use_id,
              error: b.is_error,
              content: b.content,
            });
          } else {
            emit("agent.content", { role: m.type, content: b });
          }
        }

        if (!content.length || ("error" in m && m.error)) {
          emit("claude.activity", { ...m });
        }
      }
    } else if (m.type === "system" && m.subtype === "init") {
      emit("agent.started", { model: m.model, tools: m.tools });
    } else if (m.type === "result") {
      emit("agent.completed", {
        ...m,
        cost_usd: m.total_cost_usd,
        usage: m.usage,
      });
    } else {
      emit("claude.activity", { ...m });
    }
  }
}
