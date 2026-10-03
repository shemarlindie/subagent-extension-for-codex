import { z } from "zod";
import type { Provider, RunContext } from "../model.js";
import { UnconfirmedTerminationError } from "../model.js";
import { CodexExecutors } from "./codex-executors.js";
import type { CodexSessions } from "./codex-session.js";

/** Native provider implementation; production registration still requires executor verification. */
export class CodexAgentProvider implements Provider {
  id = "codex";
  capabilities = {
    interrupt: true,
    session_continue: true,
    session_state_portable: false,
    interactive_input: true,
    worktree: true,
    cost_budget: false,
    runtime_budget: true,
    token_budget: false,
    subagents: false,
    parallel_subagents: false,
    dynamic_subagents: false,
  };
  constructor(
    private sessions: Pick<
      CodexSessions,
      "open" | "turn" | "cancel" | "cancelAndWait" | "structuredResult"
    >,
    private executors: CodexExecutors,
  ) {}
  close() {
    return this.executors.close();
  }
  async recover(task: RunContext["task"]) {
    await this.executors.recover(task);
    if (!task.session_id) return;
    if (!task.native_turn_id)
      throw new UnconfirmedTerminationError(
        [],
        "The interrupted native input has no observed coordinator turn; its outcome must be inspected before retrying",
      );
    await this.sessions.cancelAndWait(task, task.native_turn_id);
  }
  async run(c: RunContext, prompt: string) {
    if (c.task.budget.max_cost_usd !== null || c.task.budget.max_tokens)
      throw new Error(
        "Codex cannot enforce cost or token limits; explicitly disable the cost limit",
      );
    c.signal.throwIfAborted();
    // Disclose the full instructions before authorizing the execution turn.
    const permission = await c.input(
      "CodexExecution",
      {
        title: c.task.title,
        description: c.task.description,
        worker_profile: c.task.worker_profile,
        workspace: c.task.workspace,
        workspace_strategy: c.task.workspace_strategy,
        policy:
          "Allow this native Codex turn to run shell commands in its sandbox. Read-only profiles cannot write the workspace; write profiles can edit it. Git metadata and direct network access are blocked. Shell commands do not have individual approval prompts.",
      },
      c.signal,
    );
    if (!permission.approved)
      throw new Error("Native Codex execution was not approved");
    c.signal.throwIfAborted();
    const ref = await this.sessions.open(c.task, c.signal);
    c.task.session_id = ref.session_id;
    c.task.session_state_ref = ref.state_ref;
    delete c.task.native_turn_id;
    c.session(ref.session_id, ref.state_ref);
    let submitted = false;
    let turnId: string | undefined;
    let terminal = false;
    try {
      return await this.executors.run(c.task, ref, async (executor) => {
        const local = new AbortController();
        const signal = AbortSignal.any([c.signal, local.signal]);
        const stream = await this.sessions.turn(
          c.task,
          prompt,
          {
            toolHandlers: {
              AskUserQuestion: async (args) => {
                const input = z
                  .strictObject({ question: z.string().min(1).max(2000) })
                  .parse(args);
                const answer = await c.input("AskUserQuestion", input, signal);
                return {
                  answered: answer.approved,
                  input: answer.input ?? {},
                  message: answer.message ?? "",
                };
              },
            },
          },
          signal,
        );
        const consume = (async () => {
          submitted = true;
          for await (const event of stream) {
            if (
              event.type === "agent.session.turn.created" &&
              event.turn.subagent_id === null
            ) {
              turnId = event.turn.id;
              c.task.native_turn_id = turnId;
              c.session(ref.session_id, ref.state_ref);
              c.emit("agent.turn_started", { turn_id: turnId });
            }
            if ("turn_id" in event && event.turn_id === turnId) {
              if (event.type === "agent.session.turn.completed")
                terminal = true;
              if (
                event.type === "agent.session.turn.cancelled" ||
                event.type === "agent.session.turn.failed"
              ) {
                terminal = true;
                throw new Error(`Codex turn ${event.turn.status}`);
              }
              if (event.type === "agent.session.turn.output_text.delta")
                c.emit("agent.message", { text: event.delta.slice(0, 20000) });
            }
            if (event.type === "agent.session.failed")
              throw new Error("Codex session failed");
          }
          if (!turnId || !terminal)
            throw new Error("Codex turn completion unconfirmed");
          const result = await this.sessions.structuredResult(
            c.task,
            turnId,
            signal,
          );
          c.emit("agent.completed", { turn_id: turnId });
          return result;
        })();
        try {
          return await Promise.race([
            consume,
            executor.exited.then(
              () => {
                throw new UnconfirmedTerminationError(
                  [],
                  "Codex executor exited; process-group shutdown remains unconfirmed",
                );
              },
              (error) => {
                throw new UnconfirmedTerminationError(
                  [error],
                  "Codex executor exit was not confirmed",
                );
              },
            ),
          ]);
        } finally {
          local.abort(new Error("Codex turn stream closed"));
          stream.abort();
          await consume.catch(() => {});
        }
      });
    } catch (error) {
      if (submitted) {
        try {
          if (turnId) await this.sessions.cancelAndWait(c.task, turnId);
          else {
            await this.sessions.cancel(c.task, AbortSignal.timeout(10000));
            throw new Error(
              "No coordinator turn was observed; remote termination remains unconfirmed",
            );
          }
        } catch (termination) {
          throw new UnconfirmedTerminationError(
            [error, termination],
            "Codex remote termination unconfirmed",
          );
        }
      }
      throw error;
    } finally {
      try {
        await this.executors.stop(c.task, ref);
      } catch (error) {
        throw new UnconfirmedTerminationError(
          [error],
          "Codex executor shutdown unconfirmed",
        );
      }
    }
  }
}
