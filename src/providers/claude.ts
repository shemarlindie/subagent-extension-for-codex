import {
  taskClaudeMode,
  readOnlyProfile,
  resolveClaudePolicy,
  claudeOverrideDefaults,
  type ClaudePolicy,
} from "../core/permissions.js";
import {
  query,
  type Options,
  type SDKUserMessage,
  type SDKMessage,
  type SandboxSettings,
} from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import {
  join,
  resolve,
  relative,
  isAbsolute,
  dirname,
  basename,
} from "node:path";
import { realpath, readdir, access } from "node:fs/promises";
import {
  type Provider,
  type ModelChoice,
  type Task,
  type RunContext,
  type Result,
  resultSchema,
} from "../core/model.js";
import { z } from "zod";
import { git } from "../core/workspace.js";

// The extension's own credentials never reach delegated sessions. Claude
// credentials come from the user's configuration, not a subscription token.
const privateVariable = (name: string) =>
  name.startsWith("CODEX_SUBAGENT_EXTENSION_") ||
  name.startsWith("OPENAI_") ||
  name === "CLAUDE_CODE_OAUTH_TOKEN";

/** The service environment for the native harness, or only Claude authentication and basic process settings when filtered. */
export function claudeEnvironment(
  source: NodeJS.ProcessEnv,
  mode: ClaudePolicy["environment"],
): NodeJS.ProcessEnv {
  if (mode === "inherit")
    return Object.fromEntries(
      Object.entries(source).filter(
        ([name, value]) => value !== undefined && !privateVariable(name),
      ),
    );

  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "CLAUDE_CONFIG_DIR",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
  ];

  return Object.fromEntries(
    allowed.flatMap((name) =>
      source[name] === undefined ? [] : [[name, source[name]]],
    ),
  );
}

/** Native Bash restrictions; the model/API harness itself is outside this sandbox. */
export async function claudeSandbox(task: Task): Promise<SandboxSettings> {
  if (!task.workspace) throw new Error("Task workspace unavailable");
  const workspace = await realpath(task.workspace);
  const repository = await realpath(task.repository);

  const gitDirectory = await realpath(
    resolve(
      workspace,
      (await git(workspace, ["rev-parse", "--git-common-dir"])).trim(),
    ),
  );

  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    excludedCommands: [],
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    network: {
      allowedDomains: [],
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: [
        ...new Set([
          homedir(),
          repository,
          dirname(workspace),
          process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
        ]),
      ],
      allowRead: [workspace, gitDirectory],
      allowWrite: [workspace],
      denyWrite: [gitDirectory, join(workspace, ".git")],
    },
  };
}

const output = z.strictObject({
  summary: z.string(),
  findings: z.array(z.string()),
  evidence: z.array(z.string()),
  changes: z.array(z.string()),
  tests: z.array(z.string()),
  recommendations: z.array(z.string()),
});

const readTools = ["Read", "Glob", "Grep"];
const writeTools = ["Edit", "Write"];
/** File tools whose target the path guard checks. */
const pathTools = [...readTools, ...writeTools, "NotebookEdit"];

const toolPath = (input: Record<string, unknown>, workspace: string) =>
  String(input.file_path ?? input.notebook_path ?? input.path ?? workspace);

/** Whether a path stays inside the workspace and out of Git metadata, following symlinks. */
async function inWorkspace(workspace: string, path: string) {
  const target = resolve(workspace, path);
  let actual: string;

  try {
    actual = await realpath(target);
  } catch {
    // New files: resolve the parent to prevent symlink escape.
    try {
      actual = join(await realpath(dirname(target)), basename(target));
    } catch {
      return false;
    }
  }

  const rel = relative(await realpath(workspace), actual);

  return !(
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    rel === ".git" ||
    rel.startsWith(".git/")
  );
}

/** Tools without workspace paths that run after approval; entries ending in `*` match by prefix. */
const approvalTools = ["Bash", "Skill", "mcp__*"];

const approvalTool = (tool: string) =>
  approvalTools.some((entry) =>
    entry.endsWith("*") ? tool.startsWith(entry.slice(0, -1)) : tool === entry,
  );

export class ClaudeAgentProvider implements Provider {
  id = "claude";
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
  private catalogFailure?: { expires: number; error: unknown };
  constructor(private launch: typeof query = query) {}
  models(): Promise<ModelChoice[]> {
    if (this.catalog && this.catalog.expires > Date.now())
      return Promise.resolve(this.catalog.models);
    if (this.catalogRequest) return this.catalogRequest;
    if (this.catalogFailure && this.catalogFailure.expires > Date.now())
      return Promise.reject(this.catalogFailure.error);
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
      this.catalogFailure = { expires: Date.now() + 30000, error };
      throw error;
    } finally {
      clearTimeout(timer);
      release();
      session.close();
    }
  }

  async run(c: RunContext, prompt: string): Promise<Result> {
    // Tasks created before session restrictions were configurable use the defaults.
    const policy =
      c.task.claude_policy ??
      resolveClaudePolicy(claudeOverrideDefaults, c.task.worker_profile);

    const workspace = c.task.workspace!;
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    c.signal.addEventListener("abort", abort, { once: true });
    if (c.signal.aborted) abort();
    // Without a mode, the user's Claude Code settings choose it.
    const nativeMode = taskClaudeMode(c.task);
    const restricted = policy.tools === "restricted";

    const readOnly =
      restricted &&
      (readOnlyProfile(c.task.worker_profile) || nativeMode === "plan");

    const guarded = (tool: string) =>
      policy.path_guard && pathTools.includes(tool);

    // The restricted set offers file, search, approval-routed and question tools only.
    const restrictedDenial = (tool: string) =>
      !restricted ||
      tool === "AskUserQuestion" ||
      tool === "Skill" ||
      readTools.includes(tool)
        ? undefined
        : readOnly
          ? "Read-only worker profile"
          : approvalTool(tool) || writeTools.includes(tool)
            ? undefined
            : "Tool not permitted";

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
      settingSources: ["user", "project", "local"],
      ...(nativeMode ? { permissionMode: nativeMode } : {}),
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
      allowedTools: [],
      disallowedTools: policy.subagents ? [] : ["Agent", "Task"],
      ...(c.task.budget.max_cost_usd === null
        ? {}
        : {
            maxBudgetUsd: c.task.budget.max_cost_usd - (c.task.cost_usd ?? 0),
          }),
      outputFormat: { type: "json_schema", schema: resultSchema },
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `You are an independent ${c.task.worker_profile}. Work only in the provided task workspace. Return structured evidence and results. ${readOnly ? "Inspect only; you cannot edit files or run shell commands." : "Follow the configured native permission mode for tool execution."} ${c.task.workspace_strategy === "current_repo" ? "This is the current repository; preserve unrelated uncommitted changes. Write profiles edit the user checkout directly." : "Never modify the primary checkout."}`,
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

                if (tool === "StructuredOutput")
                  return output.strict().safeParse(params).success
                    ? {}
                    : deny("Invalid structured report");
                // Enabled restrictions deny before settings rules or modes can approve.
                // Skills stay available; the tools they call are checked individually.
                const denial = restrictedDenial(tool);
                if (denial) return deny(denial);
                if (
                  guarded(tool) &&
                  !(await inWorkspace(workspace, toolPath(params, workspace)))
                )
                  return deny("Path outside task workspace or Git metadata");

                return {};
              },
            ],
          },
        ],
      },
      canUseTool: async (tool, input, { signal }) => {
        if (tool === "StructuredOutput")
          return output.strict().safeParse(input).success
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "Invalid structured report" };

        if (tool === "AskUserQuestion") {
          const answer = await c.input(tool, input, signal);

          return answer.approved
            ? { behavior: "allow", updatedInput: { ...input, ...answer.input } }
            : { behavior: "deny", message: answer.message ?? "User declined" };
        }

        const denial = restrictedDenial(tool);
        if (denial) return { behavior: "deny", message: denial };

        if (guarded(tool)) {
          if (!(await inWorkspace(workspace, toolPath(input, workspace))))
            return { behavior: "deny", message: "Path outside task workspace" };
          // Guarded reads stay inside the workspace, so they need no prompt.
          if (readTools.includes(tool))
            return { behavior: "allow", updatedInput: input };
        }

        // Calls not already approved by settings or the permission mode ask the task's approver.
        const answer = await c.input(tool, input, signal);

        return answer.approved
          ? { behavior: "allow", updatedInput: input }
          : {
              behavior: "deny",
              message:
                answer.message ??
                (tool === "Bash"
                  ? "Command denied"
                  : writeTools.includes(tool)
                    ? "Edit denied"
                    : "Tool call denied"),
            };
      },
    };

    const stream = this.launch({ prompt, options });
    let result: Result | undefined;

    try {
      for await (const m of stream) {
        if ("session_id" in m && m.session_id) {
          const ref = await this.sessionPath(m.session_id, c.task.workspace!);
          c.session(m.session_id, ref);
        }

        this.normalize(c, m);

        if (m.type === "result") {
          if (m.subtype !== "success" || m.is_error)
            throw new Error(
              `Claude result: ${m.subtype}${"errors" in m ? ": " + m.errors.join("; ") : ""}`,
            );

          result = m.structured_output
            ? output.parse(m.structured_output)
            : {
                summary: m.result,
                findings: [],
                evidence: [],
                changes: [],
                tests: [],
                recommendations: [],
              };
        }
      }

      if (!result) throw new Error("Claude ended without a result");

      return result;
    } finally {
      c.signal.removeEventListener("abort", abort);
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
    const emit = (type: string, data: Record<string, unknown>) =>
      c.emit(type, { ...data, raw_response: m });

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
          if (b.type === "text")
            emit(m.type === "assistant" ? "agent.message" : "agent.content", {
              role: m.type,
              text: b.text,
              content: b,
            });
          else if (b.type === "tool_use")
            emit("tool.started", { id: b.id, name: b.name, input: b.input });
          else if (b.type === "tool_result")
            emit("tool.completed", {
              id: b.tool_use_id,
              error: b.is_error,
              content: b.content,
            });
          else emit("agent.content", { role: m.type, content: b });
        }

        if (!content.length || ("error" in m && m.error))
          emit("claude.activity", { ...m });
      }
    } else if (m.type === "system" && m.subtype === "init")
      emit("agent.started", { model: m.model, tools: m.tools });
    else if (m.type === "result")
      emit("agent.completed", {
        ...m,
        cost_usd: m.total_cost_usd,
        usage: m.usage,
      });
    else emit("claude.activity", { ...m });
  }
}
