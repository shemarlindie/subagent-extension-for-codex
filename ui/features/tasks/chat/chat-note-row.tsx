import type { ChatNote } from "../../../../src/features/tasks/chat.js";

type ChatNoteRowProps = { note: ChatNote };

/** A small marker between messages, such as a compaction or a new session. */
export function ChatNoteRow({ note }: ChatNoteRowProps) {
  const failure = note.note === "failure";

  return (
    <div
      data-chat-item={note.id}
      className="chat-note"
      data-note={note.note}
      role={failure ? "alert" : "separator"}
    >
      <span>{note.text}</span>
    </div>
  );
}
