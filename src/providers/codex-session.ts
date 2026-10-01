import OpenAI from "openai";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { type Task, resultSchema } from "../model.js";
import type {
  AgentSession,
  AgentSessionInputParam,
} from "openai/resources/beta/agents/agents";
import type { AgentSessionStreamParams } from "openai/lib/agents/agent-session-stream";

const ownerRef = (owner: string) =>
  createHash("sha256").update(owner).digest("hex");
export interface CodexSessionRef {
  session_id: string;
  state_ref: string;
  environment_id: string;
  remote_url: string;
}

/** Native Agents API boundary. Executor provisioning and its policy are separate. */
export class CodexSessions {
  constructor(
    private client: OpenAI,
    private model: string,
  ) {
    if (!model.trim())
      throw new Error("Configure an explicit Codex worker model");
  }
  private check(session: AgentSession, task: Task) {
    if (
      session.metadata.task_id !== task.id ||
      session.metadata.owner_ref !== ownerRef(task.owner)
    )
      throw new Error("Codex session does not belong to this task and owner");
    if (
      session.environment.type !== "self_hosted" ||
      session.environment.workspace_directory !== task.workspace
    )
      throw new Error(
        "Codex session environment does not match the task worktree",
      );
    return {
      session_id: session.id,
      state_ref: `openai-agent-session:${session.id}`,
      environment_id: session.environment.id,
      remote_url: session.environment.remote_url,
    };
  }
  async open(task: Task, signal?: AbortSignal): Promise<CodexSessionRef> {
    if (!task.workspace || !isAbsolute(task.workspace))
      throw new Error("Codex requires an isolated absolute worktree path");
    const sessions = this.client.beta.agents.sessions;
    if (task.session_id)
      return this.check(
        await sessions.retrieve(task.session_id, { signal }),
        task,
      );
    const session = await sessions.create(
      {
        agent: {
          model: this.model,
          instructions: `You are an independent ${task.worker_profile}. Work only in the task workspace. Return structured findings, evidence, changes, tests and recommendations.`,
          multi_agent: { enabled: false },
          text: { format: { type: "json_schema", schema: resultSchema } },
          tools: [
            {
              type: "function",
              name: "AskUserQuestion",
              description:
                "Ask the user a question needed to complete the task.",
              parameters: {
                type: "object",
                properties: {
                  question: { type: "string", minLength: 1, maxLength: 2000 },
                },
                required: ["question"],
                additionalProperties: false,
              },
            },
          ],
        },
        environment: {
          type: "self_hosted",
          workspace_directory: task.workspace,
          capability_directories: [],
        },
        metadata: { task_id: task.id, owner_ref: ownerRef(task.owner) },
      },
      {
        signal,
        headers: {
          "Idempotency-Key": `codex-subagent-extension-session-${task.id}`,
        },
      },
    );
    return this.check(session, task);
  }
  /** SDK subscribes before input and follows one coordinator turn, including idle. */
  async turn(
    task: Task,
    prompt: string,
    options: Pick<AgentSessionStreamParams, "toolHandlers"> = {},
    signal?: AbortSignal,
  ) {
    if (!task.session_id)
      throw new Error("Codex session must be persisted before submitting work");
    const session = await this.client.beta.agents.sessions.retrieve(
      task.session_id,
      { signal },
    );
    this.check(session, task);
    if (session.status !== "idle")
      throw new Error("Codex session must be idle before continuation");
    return this.client.beta.agents.sessions.stream(
      session.id,
      {
        input: prompt,
        ...options,
        idempotencyKey: `codex-subagent-extension-turn-${task.id}-${task.attempt}`,
      },
      { signal },
    );
  }
  /** A 202 response acknowledges cancellation; it does not prove the turn stopped. */
  async cancel(task: Task, signal?: AbortSignal) {
    if (!task.session_id) return;
    const session = await this.client.beta.agents.sessions.retrieve(
      task.session_id,
      { signal },
    );
    this.check(session, task);
    if (session.status === "failed") return;
    const events: AgentSessionInputParam[] = [
      { type: "agent.session.input.cancel" },
    ];
    await this.client.beta.agents.sessions.events.create(
      session.id,
      { events },
      {
        signal,
        headers: {
          "Idempotency-Key": `codex-subagent-extension-cancel-${task.id}-${task.attempt}`,
        },
      },
    );
  }
  /** Caller must exclude concurrent input. Confirm remote state before finalizing artifacts. */
  async cancelAndWait(
    task: Task,
    turnId: string,
    options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {},
  ) {
    if (!task.session_id || !turnId)
      throw new Error(
        "Persist the coordinator turn before confirming cancellation",
      );
    const timeoutMs = options.timeoutMs ?? 10000;
    const pollMs = options.pollMs ?? 250;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60000 ||
      !Number.isInteger(pollMs) ||
      pollMs < 1 ||
      pollMs > timeoutMs
    )
      throw new Error("Invalid cancellation confirmation timeout");
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([deadline, options.signal])
      : deadline;
    const sessions = this.client.beta.agents.sessions;
    const inspect = async () => {
      signal.throwIfAborted();
      const session = await sessions.retrieve(task.session_id!, { signal });
      this.check(session, task);
      const turn = await sessions.turns.retrieve(
        turnId,
        { session_id: session.id },
        { signal },
      );
      if (
        turn.id !== turnId ||
        turn.session_id !== session.id ||
        turn.subagent_id !== null
      )
        throw new Error(
          "Cancellation target is not this session's coordinator turn",
        );
      return { session, turn };
    };
    const terminal = (status: string) =>
      ["completed", "failed", "cancelled"].includes(status);
    try {
      let current = await inspect();
      if (!terminal(current.turn.status)) await this.cancel(task, signal);
      for (;;) {
        if (
          terminal(current.turn.status) &&
          ["idle", "failed"].includes(current.session.status)
        )
          return { turn: current.turn, session_status: current.session.status };
        await delay(pollMs, undefined, { signal });
        current = await inspect();
      }
    } catch (error) {
      if (deadline.aborted && !options.signal?.aborted)
        throw new Error(
          "Codex cancellation remains unconfirmed after timeout",
          { cause: error },
        );
      throw error;
    }
  }
  async status(task: Task, signal?: AbortSignal) {
    if (!task.session_id) throw new Error("Codex session unavailable");
    const session = await this.client.beta.agents.sessions.retrieve(
      task.session_id,
      { signal },
    );
    this.check(session, task);
    return {
      status: session.status,
      usage: session.usage,
      error: session.error,
    };
  }
  async structuredResult(task: Task, turnId: string, signal?: AbortSignal) {
    if (!task.session_id) throw new Error("Codex session unavailable");
    const sessions = this.client.beta.agents.sessions;
    this.check(await sessions.retrieve(task.session_id, { signal }), task);
    const turn = await sessions.turns.retrieve(
      turnId,
      { session_id: task.session_id },
      { signal },
    );
    if (
      turn.id !== turnId ||
      turn.session_id !== task.session_id ||
      turn.subagent_id !== null ||
      turn.status !== "completed"
    )
      throw new Error(
        "Codex result requires this session's completed coordinator turn",
      );
    for await (const item of sessions.items.list(
      task.session_id,
      { order: "desc", limit: 100 },
      { signal },
    )) {
      if (
        item.type !== "message" ||
        item.role !== "assistant" ||
        item.turn_id !== turnId ||
        item.phase !== "final_answer" ||
        item.status !== "completed"
      )
        continue;
      const text = item.content
        .filter((part) => part.type === "output_text")
        .map((part) => part.text)
        .join("");
      return z
        .strictObject({
          summary: z.string(),
          findings: z.array(z.string()),
          evidence: z.array(z.string()),
          changes: z.array(z.string()),
          tests: z.array(z.string()),
          recommendations: z.array(z.string()),
        })
        .parse(JSON.parse(text));
    }
    throw new Error(
      "Codex completed without a structured final result for this turn",
    );
  }
}
