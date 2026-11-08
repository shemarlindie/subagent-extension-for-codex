import { z } from "zod";

import { MAX_UPDATE_WAIT_MS } from "../../../../shared/tasks/conversation/drafts.js";
import { budgetRaiseSchema } from "../../../../shared/tasks/model.js";
import { autoRegisterChatProject } from "../../../features/projects/chat-project.js";
import { chatRead } from "../../../features/tasks/conversation/chat-read.js";
import { waitForUpdates } from "../../../features/tasks/conversation/updates.js";
import { panelTaskList } from "../../panel/panel-context.js";
import {
  composerMentionsEnabled,
  mentionSearchSchema,
  mentionSearchToolName,
  searchAgentMentions,
} from "../mentions.js";
import { activityTools } from "./activity-tools.js";
import type { agentTools } from "./agent-tools.js";
import {
  archivedFilter,
  taskId,
  tool,
  type ToolContext,
} from "./definition.js";
import { panelTimingTool } from "./panel-timing-tool.js";
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
    app_list_tasks: tool({
      readOnly: true,
      description:
        "User interface only: { tasks, read_completed }, the tasks the panel lists, newest first. Each has its full state except the conversation and context, with its latest reply excerpt, live activity, draft, read state and archive time. include names tasks to list whatever the filters say. Unless include_read_completed is true, completed tasks the user has read are left out, except included ones and the newest, and read_completed counts them by repository.",
      schema: z.object({
        conversation_id: z.string().nullable().optional(),
        repository: z.string().optional(),
        archived: archivedFilter,
        include: z.array(z.string()).max(10).optional(),
        include_read_completed: z.boolean().default(false),
      }),
      run: (a) =>
        panelTaskList(
          c,
          owner,
          {
            conversation: a.conversation_id || undefined,
            repository: a.repository || undefined,
            archived: a.archived,
            include: a.include,
          },
          a.include_read_completed,
        ),
    }),
    app_get_chat: tool({
      readOnly: true,
      description:
        "User interface only: a task's Chat after a cursor: its messages, an outcome row for each turn's end, and notes for a new session, a recreated worktree and compaction. An item read again replaces the earlier one with its id.",
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
      }),
      run: (a) => chatRead(c.store, c.store.get(a.task_id, owner), a.after),
    }),
    app_wait_for_updates: tool({
      readOnly: true,
      description: `User interface only: waits for something the panel should show. It returns the owner's current revision as soon as it differs from after, and with a draft target, as soon as that task's draft grows past after_length, becomes another message or clears; otherwise after wait_ms (at most ${MAX_UPDATE_WAIT_MS}). Without after, or with wait_ms 0, it returns at once, so it also reads a draft. The revision is opaque: compare it only for equality.`,
      schema: z.strictObject({
        after: z.string().max(200).optional(),
        draft: taskId
          .extend({
            message_id: z.string().max(200).optional(),
            after_length: z.number().int().nonnegative().default(0),
          })
          .strict()
          .optional(),
        wait_ms: z.number().int().min(0).max(MAX_UPDATE_WAIT_MS).default(0),
      }),
      run: (a) => waitForUpdates(c.store, c.drafts, owner, a),
    }),
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
