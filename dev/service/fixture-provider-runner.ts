import { setTimeout } from "node:timers/promises";

import type {
  RunContext,
  Steer,
  TurnOutput,
} from "../../src/service/features/providers/types.js";
import { readFixtureTaskOptions } from "./fixture-provider-policy.js";
import { createFixtureRunEvents } from "./fixture-run-events.js";
import {
  emitFixturePrelude,
  runFixtureActions,
  runFixtureInputs,
} from "./fixture-run-scenarios.js";
import { readScenarios } from "./fixture-scenarios.js";

interface FixtureSession {
  stateRef: string;
  turn: number;
  costUsd: number;
  history: Array<{ prompt: string; reply?: string }>;
}

export interface FixtureProviderRunState {
  sessions: Map<string, FixtureSession>;
  invalidatedTasks: Set<string>;
}

export async function runFixtureTurn(
  c: RunContext,
  prompt: string,
  state: FixtureProviderRunState,
): Promise<TurnOutput> {
  const scenarios = readScenarios(prompt);
  const steers: Steer[] = [];
  const taken: string[] = [];
  const actions: string[] = [];
  const startedAt = Date.now();
  const taskId = c.task.id;

  const baseSessionId = `fixture_${taskId}`;

  const sessionId =
    c.task.session_id ??
    (state.sessions.has(baseSessionId)
      ? `${baseSessionId}_recovery_${c.task.turn}`
      : baseSessionId);

  const stateRef = `fixture:${c.task.workspace ?? sessionId}`;

  const session = state.sessions.get(sessionId) ?? {
    stateRef,
    turn: 0,
    costUsd: 0,
    history: [],
  };

  const turn = ++session.turn;
  const previousTurns = session.history.length;
  const turnRecord: { prompt: string; reply?: string } = { prompt };

  session.history.push(turnRecord);
  state.sessions.set(sessionId, session);

  let completionEmitted = false;

  const complete = (data: Record<string, unknown>) => {
    if (completionEmitted) return;
    completionEmitted = true;
    c.emit("agent.completed", data);
  };

  const completeTurn = (
    outcome: "completed" | "failed" | "interrupted",
    details: Record<string, unknown> = {},
  ) => {
    const status = {
      completed: {
        title: "Fixture worker finished",
        statusTitle: "Fixture task completed",
        statusState: "completed",
      },
      failed: {
        title: "Fixture worker failed",
        statusTitle: "Fixture task failed",
        statusState: "failed",
        failed: true,
      },
      interrupted: {
        title: "Fixture worker interrupted",
        statusTitle: "Fixture task interrupted",
        statusState: "info",
      },
    }[outcome];

    complete({
      ...details,
      cost_usd: session.costUsd,
      total_cost_usd: session.costUsd,
      duration_ms: Date.now() - startedAt,
      activity: { ...status, liveStatus: true },
    });
  };

  c.acceptSteers((steer) => {
    steers.push(steer);

    return true;
  });

  const invalidateSession =
    scenarios.invalidateSession && !state.invalidatedTasks.has(taskId);

  if (invalidateSession) state.invalidatedTasks.add(taskId);

  c.session(sessionId, invalidateSession ? `${stateRef}:invalid` : stateRef);

  c.emit("agent.started", {
    model: c.task.model || "fixture-default",
    tools: ["Read", "Bash", "AskUserQuestion", "Agent"],
    activity: {
      title: "Fixture worker started",
      statusTitle: "Fixture worker running",
      statusState: "running",
      liveStatus: true,
    },
  });

  c.emit("agent.message", {
    role: "assistant",
    text: `Fixture worker running turn ${turn}. No model call will be made.`,
    activity: {
      title: "Fixture worker ready",
      messageId: `fixture_ready_${taskId}_${turn}`,
    },
  });

  const events = createFixtureRunEvents(c, turn);

  const failAt = (stage: string) => {
    if (scenarios.fail && scenarios.failStage === stage) {
      throw new Error(`Fixture failure at ${stage}.`);
    }
  };

  try {
    failAt("start");

    const policy = readFixtureTaskOptions(c.task).claude_policy;
    emitFixturePrelude(scenarios, policy, events, actions);

    failAt("before-input");
    await runFixtureInputs(c, scenarios, events, actions);

    failAt("after-input");
    await runFixtureActions(c, scenarios, policy, events, actions);

    failAt("after-tools");

    await waitAndTakeSteers(
      c,
      scenarios.slow,
      scenarios.waitMs,
      scenarios.late,
      steers,
      taken,
    );

    failAt("before-reply");

    const reply = createFixtureReply(
      turn,
      previousTurns,
      actions,
      taken,
      scenarios.replyLines,
    );

    turnRecord.reply = reply;
    await emitFixtureReply(c, reply, taskId, turn, scenarios.replyPaceMs);

    const usage = createUsage(prompt, reply);
    session.costUsd += scenarios.costUsd ?? 0.001;

    const completionSubtype =
      scenarios.completionSubtype ??
      (scenarios.fail ? "error_during_execution" : "success");

    const completionIsError =
      completionSubtype !== "success" || scenarios.completionIsError;

    if (completionIsError) {
      const errorDescription = `Fixture completion: ${completionSubtype}${scenarios.completionIsError ? " (is_error)" : ""}`;

      completeTurn("failed", {
        subtype: completionSubtype,
        is_error: true,
        errors: [errorDescription],
        usage,
      });

      throw new Error(errorDescription);
    }

    completeTurn("completed", {
      subtype: "success",
      is_error: false,
      result: reply,
      usage,
      num_turns: 1,
    });

    return { reply };
  } catch (error) {
    if (c.signal.aborted) {
      completeTurn("interrupted", { subtype: "interrupted", is_error: false });
    } else {
      completeTurn("failed", {
        subtype: "error_during_execution",
        is_error: true,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }

    throw error;
  }
}

async function waitAndTakeSteers(
  c: RunContext,
  slow: boolean,
  requestedWaitMs: number | undefined,
  late: boolean,
  steers: Steer[],
  taken: string[],
) {
  const duration = requestedWaitMs ?? (slow ? 480 : 80);

  let steps = 1;

  if (slow) {
    steps = 8;
  } else if (requestedWaitMs !== undefined) {
    steps = Math.max(1, Math.min(80, Math.ceil(duration / 250)));
  }

  for (let step = 0; step < steps; step++) {
    await setTimeout(duration / steps, undefined, { signal: c.signal });
    if (late) continue;

    for (const steer of steers.splice(0)) {
      c.steerTaken(steer.id);
      taken.push(steer.text);
    }
  }

  if (late) await setTimeout(200, undefined, { signal: c.signal });
}

function createFixtureReply(
  turn: number,
  previousTurns: number,
  actions: string[],
  taken: string[],
  lines: number,
) {
  return [
    "Fixture task completed. No Claude execution occurred.",
    `Fixture session turn: ${turn}.`,
    ...(previousTurns
      ? [`In-memory session retained ${previousTurns} earlier turn(s).`]
      : []),
    ...actions,
    ...taken.map((text) => `Also took: ${text}`),
    // Separate paragraphs give long replies real height in Chat.
    ...Array.from(
      { length: lines },
      (_, line) => `\nFixture reply line ${line + 1}.`,
    ),
  ].join("\n");
}

async function emitFixtureReply(
  c: RunContext,
  reply: string,
  taskId: string,
  turn: number,
  paceMs: number,
) {
  const messageId = `fixture_msg_${taskId}_${turn}`;

  for (const piece of reply.match(/\S+\s*/g) ?? []) {
    c.delta(messageId, piece);
    await setTimeout(paceMs, undefined, { signal: c.signal });
  }

  // Like Claude's normalized messages, the reply shares its draft's id.
  c.emit("agent.message", {
    message_id: messageId,
    role: "assistant",
    text: reply,
    raw_response: { message: { id: messageId }, parent_tool_use_id: null },
    activity: { title: "Fixture worker reply", messageId },
  });
}

function createUsage(prompt: string, reply: string) {
  return {
    input_tokens: Math.max(1, Math.ceil(prompt.length / 4)),
    output_tokens: Math.max(1, Math.ceil(reply.length / 4)),
  };
}
