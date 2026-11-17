import { slashCommand } from "../../../../shared/tasks/conversation/commands";

type CommandTextProps = { text: string };

/** Text with its leading command, if any, highlighted as in the composer. */
export function CommandText({ text }: CommandTextProps) {
  const command = slashCommand(text);
  if (!command) return text;

  return (
    <>
      <span className="message-command">/{command}</span>
      {text.slice(command.length + 1)}
    </>
  );
}
