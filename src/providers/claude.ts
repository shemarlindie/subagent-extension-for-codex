import {
  query,
  type Options,
  type SDKMessage,
  type SandboxSettings,
} from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { realpath, readdir, access } from "node:fs/promises";
import {
  type Provider,
  type Task,
  type RunContext,
  type Result,
  resultSchema,
} from "../model.js";
import { z } from "zod";
import { git } from "../workspace.js";
/** Only Claude authentication and basic process settings reach the native harness. */
export function claudeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
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
    "CLAUDE_CODE_OAUTH_TOKEN",
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
    subagents: false,
    parallel_subagents: false,
    dynamic_subagents: false,
  };
  constructor(private launch: typeof query = query) {}
  async run(c: RunContext, prompt: string): Promise<Result> {
    const sandbox = await claudeSandbox(c.task);
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    c.signal.addEventListener("abort", abort, { once: true });
    if (c.signal.aborted) abort();
    const readOnly = ["researcher", "reviewer", "security_reviewer"].includes(
      c.task.worker_profile,
    );
    const options: Options = {
      cwd: c.task.workspace,
      env: claudeEnvironment(),
      sandbox,
      abortController,
      persistSession: true,
      resume: c.task.session_id,
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
      permissionMode: "default",
      tools: [
        ...readTools,
        ...(readOnly ? [] : ["Edit", "Write", "Bash"]),
        "AskUserQuestion",
      ],
      allowedTools: [],
      disallowedTools: ["Agent", "Task", "Skill"],
      ...(c.task.budget.max_cost_usd === null
        ? {}
        : {
            maxBudgetUsd: c.task.budget.max_cost_usd - (c.task.cost_usd ?? 0),
          }),
      outputFormat: { type: "json_schema", schema: resultSchema },
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `You are an independent ${c.task.worker_profile}. Work only in the provided task workspace. Return structured evidence and results. ${readOnly ? "Inspect only; you cannot edit files or run shell commands." : "Request permission before shell commands."} ${c.task.workspace_strategy === "current_repo" ? "This is the current repository; preserve unrelated uncommitted changes. Write profiles edit the user checkout directly." : "Never modify the primary checkout."}`,
      },
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name !== "PreToolUse") return {};
                const tool = input.tool_name;
                const params = input.tool_input as Record<string, unknown>;
                if (tool === "AskUserQuestion") return {};
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
                if (tool === "Bash")
                  return readOnly
                    ? deny("Read-only worker profile")
                    : {
                        hookSpecificOutput: {
                          hookEventName: "PreToolUse" as const,
                          permissionDecision: "ask" as const,
                          permissionDecisionReason:
                            "Every shell command requires user approval",
                        },
                      };
                if (
                  !readTools.includes(tool) &&
                  (readOnly || !["Write", "Edit"].includes(tool))
                )
                  return deny("Tool not permitted");
                const target = resolve(
                  c.task.workspace!,
                  String(params.file_path ?? params.path ?? c.task.workspace),
                );
                let actual: string;
                try {
                  actual = await realpath(target);
                } catch {
                  try {
                    actual = join(
                      await realpath(resolve(target, "..")),
                      target.split("/").at(-1)!,
                    );
                  } catch {
                    return deny("Cannot verify path");
                  }
                }
                const rel = relative(await realpath(c.task.workspace!), actual);
                if (
                  rel.startsWith("..") ||
                  isAbsolute(rel) ||
                  rel === ".git" ||
                  rel.startsWith(".git/")
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
        if (readOnly && !readTools.includes(tool))
          return { behavior: "deny", message: "Read-only worker profile" };
        if (tool === "Bash") {
          const answer = await c.input(tool, input, signal);
          return answer.approved
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: answer.message ?? "Command denied" };
        }
        if (!readTools.includes(tool) && !["Write", "Edit"].includes(tool))
          return { behavior: "deny", message: "Tool not permitted" };
        const path = String(input.file_path ?? input.path ?? c.task.workspace);
        let actual: string;
        try {
          actual = await realpath(resolve(c.task.workspace!, path));
        } catch {
          // New files: resolve parent to prevent symlink escape.
          const target = resolve(c.task.workspace!, path);
          actual = join(
            await realpath(resolve(target, "..")),
            target.split("/").at(-1)!,
          );
        }
        const rel = relative(c.task.workspace!, actual);
        if (rel.startsWith("..") || isAbsolute(rel) || rel === ".git")
          return { behavior: "deny", message: "Path outside task workspace" };
        return { behavior: "allow", updatedInput: input };
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
