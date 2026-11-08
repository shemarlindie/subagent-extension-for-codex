import type { PanelView } from "../../../src/panel/app/state/panel-view";
import type { Draft } from "../../../src/shared/tasks/conversation/drafts";

type WaitRead = { revision: string; draft?: Draft | null };

type ViewParts = {
  list: Record<string, unknown>;
  chat?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  pending?: Record<string, unknown>;
};

/** A part of a view, named as the view names it. */
export type ViewPart = keyof Omit<PanelView, "built_at">;

/**
 * Adds the view an update wait asked for, built from each part's fixture
 * read, as `waitForUpdates` in
 * `src/service/features/tasks/conversation/updates.ts` does. It leaves the
 * view out when only the target draft changed.
 */
export function withPreviewView(
  args: Record<string, unknown>,
  read: WaitRead,
  readPart: (part: ViewPart, args: Record<string, unknown>) => unknown,
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
      projects: readPart("projects", {}),
      list: readPart("list", view.list),
      ...(view.chat && { chat: readPart("chat", view.chat) }),
      ...(view.activity && { activity: readPart("activity", view.activity) }),
      ...(view.pending && { pending: readPart("pending", view.pending) }),
    },
  };
}
