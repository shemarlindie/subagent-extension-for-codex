import { slashCommand } from "../../../../core/shared/tasks/conversation/commands";
import { MarkdownView } from "../../file-preview/markdown/markdown-view";
import { CommandText } from "./command-text";

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
