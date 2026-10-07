import { setTimeout } from "node:timers/promises";

import { fixtureMetadata } from "../src/features/providers/metadata.js";
import { executionTaskPolicy } from "../src/features/providers/task-policy.js";
import {
  type Provider,
  type RunContext,
  type Steer,
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

  /**
   * Markers in a turn's prompt shape it: `[input]` asks a question, `[fail]`
   * fails, `[slow]` runs several steps that each take pending steers, as at
   * a tool boundary, and `[late]` takes none, so they're left over. The
   * reply streams as deltas before it's stored.
   */
  async run(c: RunContext, prompt: string): Promise<TurnOutput> {
    const steers: Steer[] = [];
    const taken: string[] = [];

    c.acceptSteers((steer) => {
      steers.push(steer);

      return true;
    });

    c.session(
      c.task.session_id ?? `fixture_${c.task.id}`,
      `fixture:${c.task.workspace}`,
    );

    c.emit("agent.message", {
      text: "Fixture worker inspecting task (no model call).",
    });

    if (prompt.includes("[fail]")) throw new Error("Fixture failure");

    if (prompt.includes("[input]")) {
      const r = await c.input(
        "AskUserQuestion",
        { questions: [{ question: "Which approach should the worker use?" }] },
        c.signal,
      );

      c.emit("agent.message", { text: r.message ?? JSON.stringify(r.input) });
    }

    const steps = prompt.includes("[slow]") ? 8 : 1;

    for (let step = 0; step < steps; step++) {
      await setTimeout(prompt.includes("[slow]") ? 60 : 80, undefined, {
        signal: c.signal,
      });

      if (prompt.includes("[late]")) continue;

      for (const steer of steers.splice(0)) {
        c.steerTaken(steer.id);
        taken.push(steer.text);
      }
    }

    if (prompt.includes("[late]"))
      await setTimeout(200, undefined, { signal: c.signal });

    const reply = [
      "Fixture task completed. No Claude execution occurred.",
      ...taken.map((text) => `Also took: ${text}`),
    ].join("\n");

    // The reply streams in small pieces, then the whole message is stored.
    const messageId = `fixture_msg_${c.task.id}_${c.task.turn}`;

    for (const piece of reply.match(/\S+\s*/g) ?? []) {
      c.delta(messageId, piece);
      await setTimeout(2, undefined, { signal: c.signal });
    }

    c.emit("agent.message", {
      role: "assistant",
      text: reply,
      raw_response: { message: { id: messageId }, parent_tool_use_id: null },
    });

    return { reply };
  }
}
