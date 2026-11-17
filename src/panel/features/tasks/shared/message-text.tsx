import { slashCommand } from "../../../../shared/tasks/conversation/commands";
import { MarkdownView } from "../../file-preview/markdown/markdown-view";

/** Text with its leading command, if any, highlighted as in the composer. */
export function CommandText({ text }: { text: string }) {
  const command = slashCommand(text);
  if (!command) return text;

  return (
    <>
      <span className="message-command">/{command}</span>
      {text.slice(command.length + 1)}
    </>
  );
}

type MessageTextProps = {
  text: string;
  className: string;
  markdown?: boolean;
  /** Whether a leading command stands out. The worker's text runs none. */
  commands?: boolean;
};

/**
 * A message's text. A command sent to the worker stays literal, with its
 * name highlighted, and other text renders as Markdown when asked.
 */
export function MessageText({
  text,
  className,
  markdown,
  commands = true,
}: MessageTextProps) {
  const command = commands && slashCommand(text) !== undefined;

  if (markdown && !command) {
    return (
      <div className={className}>
        <MarkdownView content={text} />
      </div>
    );
  }

  return (
    <p className={className}>{command ? <CommandText text={text} /> : text}</p>
  );
}
