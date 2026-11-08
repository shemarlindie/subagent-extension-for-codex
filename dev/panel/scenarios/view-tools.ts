import type { Draft } from "../../../src/shared/tasks/conversation/drafts";

type WaitRead = { revision: string; draft?: Draft | null };

type ViewParts = {
  list: Record<string, unknown>;
  chat?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  pending?: Record<string, unknown>;
};

/**
 * Adds the view an update wait asked for, built from each part's own fixture
 * tool, as `waitForUpdates` in
 * `src/service/features/tasks/conversation/updates.ts` does. It leaves the
 * view out when only the target draft changed.
 */
export function withPreviewView(
  args: Record<string, unknown>,
  read: WaitRead,
  call: (name: string, args: Record<string, unknown>) => unknown,
) {
  const view = args.view as ViewParts;

  const target = args.draft as
    { message_id?: string; after_length?: number } | undefined;

  const draftMoved =
    target &&
    (read.draft
      ? read.draft.message_id !== target.message_id ||
        read.draft.text.length > (target.after_length ?? 0)
      : target.message_id !== undefined);

  if (args.after === read.revision && draftMoved) return read;

  return {
    ...read,
    view: {
      built_at: Date.now(),
      projects: call("list_projects", {}),
      list: call("app_list_tasks", view.list),
      ...(view.chat && { chat: call("app_get_chat", view.chat) }),
      ...(view.activity && {
        activity: call("app_get_activity", view.activity),
      }),
      ...(view.pending && {
        pending: call("app_list_pending_updates", view.pending),
      }),
    },
  };
}
