import { z } from "zod";

import { budgetRaiseSchema } from "../../../../shared/tasks/model.js";
import { autoRegisterChatProject } from "../../../features/projects/chat-project.js";
import { aboutInfo } from "../../service/about.js";
import {
  composerMentionsEnabled,
  mentionSearchSchema,
  mentionSearchToolName,
  searchAgentMentions,
} from "../mentions.js";
import { activityTools } from "./activity-tools.js";
import type { agentTools } from "./agent-tools.js";
import { taskId, tool, type ToolContext } from "./definition.js";
import { panelTimingTool } from "./panel-timing-tool.js";
import { panelViewTools } from "./panel-view-tools.js";
import { pendingUpdateTools } from "./pending-update-tools.js";
import { projectTools } from "./project-tools.js";
import { queueTools } from "./queue-tools.js";
import { settingsTransferTools } from "./settings-transfer-tools.js";
import { taskLifecycleTools } from "./task-lifecycle-tools.js";

/**
 * App-only tools, named with an `app_` prefix. The panel calls them on the
 * user's behalf. `callTool` refuses them to other callers. Several extend
 * an agent tool with user authority.
 */
export function userTools(
  { c, owner, hostMeta }: ToolContext,
  tools: ReturnType<typeof agentTools>,
) {
  return {
    app_get_about: tool({
      readOnly: true,
      description:
        "User interface only: extension build, SDK versions and local runtime diagnostics.",
      schema: z.object({ refresh: z.boolean().default(false) }),
      run: ({ refresh }) => aboutInfo(c, refresh),
    }),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Temporary feature gate.
    ...(composerMentionsEnabled
      ? {
          // The host's composer calls this. The HTTP and stdio servers register it
          // with the mention extension metadata.
          [mentionSearchToolName]: tool({
            readOnly: true,
            description:
              "Search for the configured Claude provider in the composer mention picker.",
            schema: mentionSearchSchema,
            run: ({ query }) => searchAgentMentions(query, c.workers()),
          }),
        }
      : {}),
    ...projectTools(c, owner),
    app_start_task: tool({
      ...tools.start_task,
      // The panel already shows the new task, so it opens no inline panel.
      panel: false,
      description:
        "User interface only: create a task with the user-selected native permission mode.",
      run: async (a) => {
        await autoRegisterChatProject(c, owner, hostMeta, a.repository);

        return c.start(
          owner,
          { ...a, conversation_id: a.conversation_id ?? undefined },
          "user",
        );
      },
    }),
    app_send_message: tool({
      ...tools.send_message,
      description:
        "User interface only: send the user's message to a task, as send_message does.",
      run: async (a) => {
        const sent = await c.send(owner, a.task_id, a.message, "user", {
          delivery: a.delivery,
          budget: a.budget,
          request_id: a.request_id,
        });

        return {
          message_id: sent.message_id,
          state: sent.state,
          status: sent.task.status,
        };
      },
    }),
    app_raise_budget: tool({
      description:
        "User interface only: apply higher task budget limits without sending a message or starting a turn. Each limit can only increase or be set to null to remove the limit.",
      schema: taskId.extend({ budget: budgetRaiseSchema }),
      run: (a) => {
        const task = c.applyBudget(owner, a.task_id, a.budget);

        return { budget: task.budget, status: task.status };
      },
    }),
    ...panelViewTools(c, owner),
    ...queueTools(c, owner),
    app_submit_input: tool({
      ...tools.submit_input,
      description:
        "User interface only: submit the user decision for the exact pending request.",
      run: (a) =>
        c.input(
          owner,
          a.task_id,
          a.request_id,
          a.approved,
          a.input,
          a.message,
          "user",
        ),
    }),
    app_update_settings: tool({
      ...tools.update_settings,
      description:
        "User interface only: save delegation defaults, including native permission mode and approval decision maker.",
      run: (a) => c.settings.update(owner, a, "user"),
    }),
    ...settingsTransferTools(c.settings, owner),
    ...activityTools(c, owner),
    app_record_timing: panelTimingTool(),
    ...taskLifecycleTools(c, owner),
    ...pendingUpdateTools(c, owner),
  };
}
