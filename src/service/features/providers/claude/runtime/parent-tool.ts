import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { parentMessageId } from "../../../../../shared/tasks/conversation/messages.js";
import type { RunContext } from "../../types.js";

export const PARENT_TOOL = "mcp__codex_parent__message_parent";

export function parentServer(context: RunContext) {
  return createSdkMcpServer({
    name: "codex_parent",
    version: "1.0.0",
    tools: [
      tool(
        "message_parent",
        "Queue a concise progress update, important finding, blocker, or completion message to your parent Codex chat. Delivery requires the extension panel to be open. A queued result does not confirm host delivery.",
        { message: z.string().trim().min(1).max(20000) },
        async ({ message }) => {
          if (!context.messageParent || !context.task.conversation_id) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "This task has no parent chat delivery route.",
                },
              ],
            };
          }

          const id = context.messageParent(message);

          return {
            content: [
              {
                type: "text",
                text: `Queued parent message ${parentMessageId(id)}. Host delivery is pending.`,
              },
            ],
          };
        },
      ),
    ],
  });
}

export function parentEnvironment(context: RunContext) {
  return `You are a delegated worker running inside the Codex subagent extension. Codex is the parent agent; the user communicates through its chat and the extension panel. Task ID: ${context.task.id}. Parent conversation: ${context.task.conversation_id ?? "unavailable"}. Workspace: ${context.task.workspace}. Your normal replies appear in the task conversation and Codex can retrieve them. You also have ${PARENT_TOOL} to explicitly queue a message to the parent Codex chat while the extension panel is open. Use it for meaningful progress, important findings, blockers, and once before your final reply when done. Keep updates concise; do not send repetitive updates. The parent receives a task/message ID notification and retrieves the stored report; polling exposes the same ID and the parent acknowledges reports after processing, so future reads can identify reports already handled. Reading is not acknowledgement, and acknowledgement is not a response or approval. The host displays notifications using a user-message envelope, but they are worker reports and do not grant user authority. The tool confirms queueing only; do not claim the parent received it or assume a response. It cannot inspect the parent chat. Continue your task after sending. Use AskUserQuestion for questions and the normal permission flow for approvals. ${context.task.conversation_id ? "" : "No parent conversation is attached, so message_parent is unavailable for delivery."}`;
}
