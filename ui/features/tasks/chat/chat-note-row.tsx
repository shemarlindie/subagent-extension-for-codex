import type { ChatNote } from "../../../../src/features/tasks/chat.js";

type ChatNoteRowProps = { note: ChatNote };

/** A small marker between messages, such as a compaction or a new session. */
export function ChatNoteRow({ note }: ChatNoteRowProps) {
  return (
    <div className="chat-note" data-note={note.note} role="separator">
      <span>{note.text}</span>
    </div>
  );
}
