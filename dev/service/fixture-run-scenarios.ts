import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { structuredPatch } from "diff";

import type { RunContext } from "../../src/service/features/providers/types.js";
import type { readFixtureTaskOptions } from "./fixture-provider-policy.js";
import type { FixtureRunEvents } from "./fixture-run-events.js";
import { fixtureToolInput } from "./fixture-run-events.js";
import type { FixtureScenarios } from "./fixture-scenarios.js";

type FixturePolicy = ReturnType<typeof readFixtureTaskOptions>["claude_policy"];

export function emitFixturePrelude(
  scenarios: FixtureScenarios,
  events: FixtureRunEvents,
  actions: string[],
) {
  for (const activity of scenarios.activities) {
    events.emitActivity(activity.type, activity.fields);
    actions.push(`Emitted fixture activity: ${activity.type}.`);
  }

  for (const error of scenarios.assistantErrors) {
    events.emitActivity("assistant", {
      error,
      message: { content: [] },
    });

    actions.push(`Emitted SDK assistant error: ${error}.`);
  }

  if (scenarios.streamLifecycle) {
    events.emitStream("message_start", {});
    events.emitStream("content_block_start", { block: "text" });

    events.emitStream("content_block_delta", {
      delta: "text",
      text: "Fixture stream delta.",
    });

    events.emitStream("content_block_stop", {});
    events.emitStream("message_delta", { stop_reason: "end_turn" });
    events.emitStream("message_stop", {});
    actions.push("Emitted a complete fixture stream lifecycle.");
  } else {
    for (const stream of scenarios.streams) {
      events.emitStream(stream.frame, stream.fields);
    }
  }
}

// One request stacks a single choice, a multiple choice and a typed answer.
const fixtureQuestionForm = [
  {
    header: "Path",
    question: "Which fixture path should be used?",
    options: [
      { label: "Integration", description: "Use the integration path." },
      { label: "Unit", description: "Use the unit path." },
    ],
  },
  {
    header: "Checks",
    question: "Which fixture checks should run?",
    multiSelect: true,
    options: [{ label: "Lint" }, { label: "Types" }, { label: "Tests" }],
  },
  { header: "Notes", question: "Any notes for the fixture worker?" },
];

export async function runFixtureInputs(
  c: RunContext,
  scenarios: FixtureScenarios,
  events: FixtureRunEvents,
  actions: string[],
) {
  for (let question = 0; question < scenarios.questionCount; question++) {
    const answer = await c.input(
      "AskUserQuestion",
      {
        questions: [
          {
            question: `Which fixture path should be used? (${question + 1}/${scenarios.questionCount})`,
          },
        ],
      },
      c.signal,
    );

    actions.push(
      answer.message ??
        JSON.stringify(answer.input ?? { answer: "No response" }),
    );
  }

  if (scenarios.questionForm) {
    const answer = await c.input(
      "AskUserQuestion",
      { questions: fixtureQuestionForm },
      c.signal,
    );

    actions.push(
      answer.message ??
        JSON.stringify(answer.input ?? { answer: "No response" }),
    );
  }

  for (const tool of scenarios.permissionTools) {
    const input = fixtureToolInput(
      tool,
      "fixture/sample.txt",
      "fixture permission check --safe",
      "fixture write",
    );

    const id = events.startTool(tool, input);

    const answer = await c.input(tool, input, c.signal, {
      description: "This fake tool call makes no repository changes.",
      approveLabel: `Allow the fixture ${tool} request`,
      formTitle: "Fixture permission scenario",
      formMessage: `The fixture worker is requesting approval for a fake ${tool} call.`,
      formApproveLabel: `Allow ${tool}`,
    });

    const message = answer.approved
      ? `Fixture ${tool} request approved; no real tool ran.`
      : `Fixture ${tool} request denied${answer.message ? `: ${answer.message}` : "."}`;

    events.finishTool(id, tool, input, !answer.approved, message);
    actions.push(message);
  }
}

export async function runFixtureActions(
  c: RunContext,
  scenarios: FixtureScenarios,
  policy: FixturePolicy,
  events: FixtureRunEvents,
  actions: string[],
) {
  for (const name of scenarios.toolNames) {
    const input = fixtureToolInput(
      name,
      "fixture/sample.txt",
      "fixture read-only command",
    );

    const id = events.startTool(name, input);

    events.finishTool(
      id,
      name,
      input,
      false,
      "Fixture tool result. No file was read.",
    );

    actions.push(`${name} completed with a fixture result.`);
  }

  for (const name of scenarios.toolErrorNames) {
    const input = fixtureToolInput(
      name,
      "fixture/missing.txt",
      "fixture failing command",
    );

    const id = events.startTool(name, input);
    events.finishTool(id, name, input, true, "Fixture tool error scenario.");
    actions.push(`${name} returned a fixture error.`);
  }

  for (const content of scenarios.content) {
    events.emitContent(content);
    actions.push(`Emitted fixture ${content.kind} content.`);
  }

  if (scenarios.change) {
    if (c.task.workspace_strategy !== "worktree") {
      throw new Error(
        "Fixture change scenarios require an isolated worktree task.",
      );
    }

    const safeTaskId = c.task.id.replace(/[^A-Za-z0-9_-]/g, "_");
    const relativePath = `fixture-scenario-${safeTaskId}-turn-${c.task.turn}.md`;

    await writeFile(
      join(c.task.workspace!, relativePath),
      `# Fixture change\n\nGenerated for task ${c.task.id}, turn ${c.task.turn}.\n`,
      { flag: "wx" },
    );

    c.fileChanged({
      path: relativePath,
      source: "tool",
      created: true,
      hunks: structuredPatch(
        "",
        "",
        "",
        `# Fixture change\n\nGenerated for task ${c.task.id}, turn ${c.task.turn}.\n`,
        undefined,
        undefined,
        { context: 3 },
      ).hunks,
    });

    events.emitActivity("files_persisted", { files: [relativePath] });
    actions.push(`Created ${relativePath} in the isolated task worktree.`);
  }

  if (scenarios.thinking) {
    events.emitPresented("agent.content", {
      role: "assistant",
      content: { type: "thinking", thinking: "Fixture thinking block." },
    });

    actions.push("Emitted a fixture thinking block.");
  }

  if (scenarios.subagent) {
    if (policy?.subagents === false) {
      events.emitActivity("permission_denied", {
        tool_name: "Agent",
        message: "Fixture subagents are disabled by the selected policy.",
      });

      actions.push("The selected fixture policy blocked subagents.");
    } else {
      const children = Array.from(
        { length: scenarios.subagentCount },
        (_, index) => {
          const description = `Fixture child worker ${index + 1}`;
          const input = { description };
          const id = events.startTool("Agent", input);
          const childId = `fixture_child_${c.task.id}_${c.task.turn}_${index + 1}`;

          c.emit("agent.started", {
            agent_id: childId,
            parent_tool_use_id: id,
            model: c.task.model || "fixture-default",
            activity: {
              title: `${description} started`,
              statusState: "running",
              liveStatus: true,
            },
          });

          return { childId, description, id, input };
        },
      );

      for (const child of children) {
        const failed = ["failed", "error"].includes(scenarios.subagentOutcome);

        const result = failed
          ? `${child.description} failed its simulated task.`
          : `${child.description} completed its simulated task.`;

        c.emit("agent.message", {
          agent_id: child.childId,
          parent_tool_use_id: child.id,
          role: "assistant",
          text: result,
        });

        c.emit("agent.completed", {
          agent_id: child.childId,
          parent_tool_use_id: child.id,
          result,
          ...(failed
            ? {
                subtype: "error_during_execution",
                is_error: true,
                errors: ["Fixture child failure."],
              }
            : {}),
          activity: {
            title: `${child.description} ${failed ? "failed" : "finished"}`,
            statusState: failed ? "failed" : "completed",
            failed,
          },
        });

        events.finishTool(
          child.id,
          "Agent",
          child.input,
          failed,
          failed ? "Fixture child failure." : result,
        );
      }

      actions.push(
        `Emitted ${children.length} simulated child-worker lifecycle(s).`,
      );
    }
  }
}
