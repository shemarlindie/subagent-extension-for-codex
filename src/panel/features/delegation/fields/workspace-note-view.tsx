import { Notice } from "../../../shared/components/notice/notice";
import type { workspaceNote } from "../workspace-note";

type WorkspaceNoteViewProps = {
  note: ReturnType<typeof workspaceNote>;
};

/** Says how a task will edit a project with no commit, when it matters. */
export function WorkspaceNoteView({ note }: WorkspaceNoteViewProps) {
  if (!note) return null;

  return (
    <Notice
      tone={note.warning ? "warning" : "plain"}
      className="workspace-note"
    >
      <p>{note.message}</p>
    </Notice>
  );
}
