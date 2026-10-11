import { claudeActivityPresentation } from "../../src/service/features/providers/claude/events/activity.js";
import type { RunContext } from "../../src/service/features/providers/types.js";
import {
  applyFixtureFieldOverrides,
  fixtureActivityPayload,
  fixtureStreamPayload,
} from "./fixture-events.js";
import {
  type FixtureContentScenario,
  type FixtureStreamFrame,
  safeToolName,
} from "./fixture-scenarios.js";

export interface FixtureRunEvents {
  startTool(name: string, input: Record<string, unknown>): string;
  finishTool(
    id: string,
    name: string,
    input: Record<string, unknown>,
    error: boolean,
    content: string,
  ): void;
  emitActivity(type: string, fields: Record<string, unknown>): void;
  emitStream(frame: FixtureStreamFrame, fields: Record<string, unknown>): void;
  emitPresented(type: string, data: Record<string, unknown>): void;
  emitContent(scenario: FixtureContentScenario): void;
}

/** Keep every synthetic event for a single turn on the same task and turn ids. */
export function createFixtureRunEvents(
  c: RunContext,
  turn: number,
): FixtureRunEvents {
  const taskId = c.task.id;
  let actionIndex = 0;

  const startTool = (name: string, input: Record<string, unknown>) => {
    const id = `fixture_tool_${taskId}_${turn}_${++actionIndex}`;

    c.emit("tool.started", {
      id,
      name,
      input,
      activity: {
        operation: {
          id,
          kind: "tool",
          title: `${name} started`,
          started: true,
        },
      },
    });

    return id;
  };

  const finishTool = (
    id: string,
    name: string,
    input: Record<string, unknown>,
    error: boolean,
    content: string,
  ) =>
    c.emit("tool.completed", {
      id,
      name,
      input,
      error,
      content,
      activity: {
        operation: {
          id,
          kind: "tool",
          title: `${name} ${error ? "failed" : "completed"}`,
          completed: true,
          ...(error ? { stopped: true } : {}),
        },
      },
    });

  const emitActivity = (type: string, fields: Record<string, unknown>) =>
    c.emit(
      "claude.activity",
      fixtureActivityPayload(type, fields, taskId, turn),
    );

  const emitStream = (
    frame: FixtureStreamFrame,
    fields: Record<string, unknown>,
  ) =>
    c.emit(
      "claude.activity",
      fixtureStreamPayload(frame, fields, taskId, turn),
    );

  const emitPresented = (type: string, data: Record<string, unknown>) => {
    const provided = data.activity;

    const activity = {
      ...claudeActivityPresentation({ type, data }),
      ...(provided && typeof provided === "object" && !Array.isArray(provided)
        ? provided
        : {}),
    };

    c.emit(type, { ...data, activity });
  };

  const emitContent = (scenario: FixtureContentScenario) => {
    const name = safeToolName(scenario.name, "Read");
    const id = `fixture_content_${taskId}_${turn}_${++actionIndex}`;
    const failed = scenario.outcome === "error";

    if (scenario.kind === "tool_use") {
      const input = fixtureToolInput(
        name,
        "fixture/content-tool.txt",
        "fixture content tool",
      );

      applyFixtureFieldOverrides(input, scenario.fields ?? {});

      const toolId = startTool(name, input);

      if (scenario.outcome !== "running")
        finishTool(
          toolId,
          name,
          input,
          failed,
          failed
            ? "Fixture content tool failed."
            : "Fixture content tool result.",
        );

      return;
    }

    if (scenario.kind === "tool_result") {
      const content =
        scenario.fields?.content ??
        (failed
          ? "Fixture content tool result failed."
          : "Fixture content tool result.");

      emitPresented("tool.completed", {
        id,
        name,
        error: failed,
        content,
      });

      return;
    }

    if (scenario.kind === "empty" || scenario.kind === "error") {
      emitPresented("agent.content", {
        role: scenario.role,
        content: [],
      });

      if (scenario.kind === "error")
        emitActivity(scenario.role, {
          error: true,
          message:
            scenario.fields?.message ?? "Fixture empty-content error event.",
        });

      return;
    }

    const content = createFixtureContentBlock(scenario);

    if (content && typeof content === "object" && !Array.isArray(content))
      applyFixtureFieldOverrides(
        content as Record<string, unknown>,
        scenario.fields ?? {},
      );

    emitPresented("agent.content", { role: scenario.role, content });
  };

  return {
    startTool,
    finishTool,
    emitActivity,
    emitStream,
    emitPresented,
    emitContent,
  };
}

export function fixtureToolInput(
  name: string,
  filePath: string,
  command: string,
  content?: string,
): Record<string, unknown> {
  return name === "Bash"
    ? { command }
    : { file_path: filePath, ...(content ? { content } : {}) };
}

function createFixtureContentBlock(scenario: FixtureContentScenario): unknown {
  switch (scenario.kind) {
    case "thinking":
      return { type: "thinking", thinking: "Fixture thinking content." };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "aGVsbG8=",
        },
      };
    case "document":
      return {
        type: "document",
        source: { type: "text", data: "Fixture document content." },
      };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: "fixture-redacted" };
    case "text":
      return (
        scenario.fields?.text ?? "Fixture content event for activity rendering."
      );
    default:
      return {
        type: scenario.kind,
        text: `Fixture ${scenario.kind} content.`,
      };
  }
}
