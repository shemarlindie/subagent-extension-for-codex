// Answers the panel's tool calls from the story, through the same fixture
// dispatcher the dev host uses.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { fixtureCall } from "../host/host-helpers";
import type { PreviewData } from "../scenarios/live-preview";
import { STORY_REPOSITORY, STORY_THREAD, storyAt } from "./story";

function storyData(step: number): PreviewData {
  const current = storyAt(step);

  return {
    tasks: current ? [current.task] : [],
    taskFor: (task) => task,
    eventsFor: (id) =>
      current && id === current.task.id ? current.events : [],
    draftFor: () => undefined,
    revision: `showcase:${step}`,
  };
}

/** The fixture result for a tool call, with the story as of a step. */
export function storyTool(
  step: number,
  name: string,
  args: Record<string, unknown>,
): CallToolResult {
  return fixtureCall(name, args, {
    data: storyData(step),
    addedProjects: [STORY_REPOSITORY],
  });
}

/** Opens the panel on the story task, as Codex does after start_task. */
export function storyLaunch(step: number) {
  const current = storyAt(step);

  return storyTool(step, "open_codex_subagent_extension", {
    conversation_id: STORY_THREAD,
    ...(current ? { task_id: current.task.id } : {}),
  });
}
