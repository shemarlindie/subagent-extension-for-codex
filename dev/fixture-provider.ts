import { setTimeout } from "node:timers/promises";

import { fixtureMetadata } from "../src/features/providers/metadata.js";
import { executionTaskPolicy } from "../src/features/providers/task-policy.js";
import {
  type Provider,
  type RunContext,
  type TurnOutput,
} from "../src/shared/contracts.js";

/**
 * A development-only worker that makes no model calls, for the demo service
 * (dev/demo-service.ts) and tests. It is outside src/, so it never ships.
 */
export class FixtureProvider implements Provider {
  id = "fixture";
  taskPolicy = executionTaskPolicy;
  metadata = fixtureMetadata;
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

  async run(c: RunContext, prompt: string): Promise<TurnOutput> {
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
        { questions: [{ question: "Which approach should the worker use?" }] },
        c.signal,
      );

      c.emit("agent.message", { text: r.message ?? JSON.stringify(r.input) });
    }

    await setTimeout(80, undefined, { signal: c.signal });

    return {
      reply: "Fixture task completed. No Claude execution occurred.",
    };
  }
}
