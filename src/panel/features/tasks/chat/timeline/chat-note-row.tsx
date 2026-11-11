import { memo } from "react";

import type { ChatNote } from "../../../../../shared/tasks/conversation/chat.js";

type ChatNoteRowProps = { note: ChatNote };

const NOTE_ROLES: Partial<Record<ChatNote["note"], string>> = {
  failure: "alert",
  limited: "note",
};

/** A small marker between messages, such as a compaction or a new session. */
export const ChatNoteRow = memo(function ChatNoteRow({
  note,
}: ChatNoteRowProps) {
  return (
    <div
      data-chat-item={note.id}
      className="chat-note"
      data-note={note.note}
      role={NOTE_ROLES[note.note] ?? "separator"}
    >
      <span>{note.text}</span>
    </div>
  );
});
