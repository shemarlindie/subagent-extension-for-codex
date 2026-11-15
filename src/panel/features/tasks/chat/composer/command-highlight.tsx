import type { RefObject } from "react";

import type { ProviderCommand } from "../../../../../shared/providers/types";

/** The command a draft starts with, by name or alias, if the task has it. */
export function draftCommand(commands: ProviderCommand[], draft: string) {
  const typed = /^\/(\S+)(?=\s|$)/.exec(draft)?.[1];

  return typed === undefined
    ? undefined
    : commands.find(
        ({ name, aliases }) => name === typed || aliases.includes(typed),
      );
}

type CommandHighlightProps = {
  ref: RefObject<HTMLDivElement | null>;
  command: ProviderCommand;
  draft: string;
};

/**
 * Paints the draft behind its transparent textarea, coloring the command and
 * showing its argument hint until an argument is typed.
 */
export function CommandHighlight({
  ref,
  command,
  draft,
}: CommandHighlightProps) {
  const name = /^\S*/.exec(draft)?.[0] ?? "";
  const rest = draft.slice(name.length);

  return (
    <div ref={ref} className="command-highlight" aria-hidden="true">
      <span className="command-highlight-name">{name}</span>
      {rest}
      {command.argument_hint && /^ +$/.test(rest) && (
        <span className="command-highlight-hint">{command.argument_hint}</span>
      )}
    </div>
  );
}
