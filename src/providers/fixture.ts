import { setTimeout } from "node:timers/promises";
import { type Provider, type RunContext, type Result } from "../core/model.js";
export class FixtureProvider implements Provider {
  id = "fixture";
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
  async run(c: RunContext, prompt: string): Promise<Result> {
    c.session(
      c.task.session_id ?? `fixture_${c.task.id}`,
      `fixture:${c.task.workspace}`,
    );
    c.emit("agent.message", {
      text: "Fixture worker inspecting task (no model call).",
    });
    if (prompt.includes("[input]")) {
      const r = await c.input(
        "AskUserQuestion",
        { question: "Which approach should the worker use?" },
        c.signal,
      );
      c.emit("agent.message", { text: r.message ?? JSON.stringify(r.input) });
    }
    await setTimeout(80, undefined, { signal: c.signal });
    return {
      summary: "Fixture task completed. No Claude execution occurred.",
      findings: [],
      evidence: [],
      changes: [],
      tests: ["Lifecycle fixture"],
      recommendations: [],
    };
  }
}
