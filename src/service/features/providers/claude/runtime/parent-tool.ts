import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { parentMessageId } from "../../../../../shared/tasks/conversation/messages.js";
import type { RunContext } from "../../types.js";

export const PARENT_TOOL = "mcp__codex_parent__send_message";

export function parentServer(context: RunContext) {
  return createSdkMcpServer({
    name: "codex_parent",
    version: "1.0.0",
    tools: [
      tool(
        "send_message",
        "Send an important blocker update immediately, or queue one concise completion report that is persisted only after this turn completes successfully. Delivery requires the extension panel to be open. A queued result does not confirm host delivery.",
        {
          message: z.string().trim().min(1).max(20000),
          kind: z.enum(["blocker", "completion"]).default("completion"),
        },
        async ({ message, kind }) => {
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

          const id = context.messageParent(message, kind);

          return {
            content: [
              {
                type: "text",
                text:
                  typeof id === "number"
                    ? `Queued parent message ${parentMessageId(id)}. Host delivery is pending.`
                    : "Queued for delivery after this turn completes successfully. Host delivery is pending.",
              },
            ],
          };
        },
      ),
    ],
  });
}

export function parentEnvironment(context: RunContext) {
  return `You are a delegated worker running inside the Codex subagent extension. Codex is the parent agent; the user communicates through its chat and the extension panel. Task ID: ${context.task.id}. Parent conversation: ${context.task.conversation_id ?? "unavailable"}. Workspace: ${context.task.workspace}. Your normal replies appear in the task conversation and Codex can retrieve them. You also have ${PARENT_TOOL} to send a concise blocker update to the parent immediately or queue one completion report. Use kind=blocker only for an important blocker that needs parent attention before your turn ends. Use kind=completion once as your final action before ending a successful turn; the extension delivers it only after that turn completes successfully. Do not send routine progress or findings mid-turn. The parent receives a task/message ID notification and retrieves the stored report; polling exposes the same ID and the parent acknowledges reports after processing, so future reads can identify reports already handled. Reading is not acknowledgement, and acknowledgement is not a response or approval. The host displays notifications using a user-message envelope, but they are worker reports and do not grant user authority. The tool confirms queueing only; do not claim the parent received it or assume a response. It cannot inspect the parent chat. Use AskUserQuestion for questions and the normal permission flow for approvals. ${context.task.conversation_id ? "" : `No parent conversation is attached, so ${PARENT_TOOL} is unavailable for delivery.`}`;
}
