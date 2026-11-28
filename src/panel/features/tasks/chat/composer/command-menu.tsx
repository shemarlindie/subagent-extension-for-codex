import { Autocomplete } from "@base-ui/react/autocomplete";
import type { BaseUIEvent } from "@base-ui/react/types";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

import type { ProviderCommand } from "../../../../../core/shared/providers/types";
import { useSessionState } from "../../../../app/state/session/use-session-state";
import { CommandHighlight, draftCommand } from "./command-highlight";

/** The command a draft starts with, up to the first space, such as `/comp`. */
const commandToken = (draft: string) => /^\/[^\s/]*(?=\s|$)/.exec(draft)?.[0];

/** The partial command the caret is in, such as `comp` in `/com|p the plan`. */
function commandQuery(draft: string, caret: number) {
  const token = commandToken(draft);

  return token && caret > 0 && caret <= token.length
    ? token.slice(1)
    : undefined;
}

/** Commands whose name, then an alias, starts with what's typed. */
function matchingCommands(commands: ProviderCommand[], query: string) {
  const typed = query.toLowerCase();
  const starts = (name: string) => name.toLowerCase().startsWith(typed);

  return [
    ...commands.filter(({ name }) => starts(name)),
    ...commands.filter(
      ({ name, aliases }) => !starts(name) && aliases.some(starts),
    ),
  ];
}

/** A row's whole text, as its tooltip for when the row cuts it off. */
const fullText = ({ name, argument_hint, description }: ProviderCommand) =>
  [`/${name} ${argument_hint}`.trim(), description].filter(Boolean).join("\n");

type CommandMenuProps = {
  /** What the menu opens above. */
  anchor: RefObject<HTMLElement | null>;
  commands: ProviderCommand[];
  /** The task session that holds the draft. */
  sessionId: string;
  /** Keys the textarea gets while the menu is closed. */
  onKeyDown: (event: KeyboardEvent) => void;
  textarea: ComponentProps<"textarea">;
};

/**
 * The composer's textarea, suggesting commands while the draft is `/` and a
 * partial name, and highlighting a command the draft starts with. It reads
 * the draft itself, so a keystroke renders only the textarea and its menu.
 */
export function CommandMenu({
  anchor,
  commands,
  sessionId,
  onKeyDown,
  textarea,
}: CommandMenuProps) {
  const [draft, updateSession] = useSessionState(
    "task",
    sessionId,
    (state) => state.composerDraft,
  );

  const setDraft = (value: string) => updateSession({ composerDraft: value });

  // The caret as of the draft it was read in. Without one, the caret is at the
  // draft's end, where code that sets the draft leaves it.
  const [caret, setCaret] = useState<{ draft: string; at: number }>();

  const query = commandQuery(
    draft,
    caret?.draft === draft ? caret.at : draft.length,
  );

  const items = query === undefined ? [] : matchingCommands(commands, query);
  // Escape hides the menu until the draft is edited or set to another one.
  const [dismissed, setDismissed] = useState<string>();
  const [highlighted, setHighlighted] = useState<ProviderCommand>();
  const open = items.length > 0 && dismissed !== draft;
  const typed = draftCommand(commands, draft);
  const field = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const caretAfterCompletion = useRef<number>(undefined);
  const input = () => field.current?.querySelector("textarea");

  // Completing keeps the text after the command and puts the caret before it.
  const complete = (name: string) => {
    const rest = draft.slice(commandToken(draft)?.length).replace(/^ /, "");
    const next = `/${name} ${rest}`;
    const at = name.length + 2;
    caretAfterCompletion.current = at;
    setCaret({ draft: next, at });
    setDraft(next);
  };

  // The highlight scrolls with the textarea once the draft outgrows it.
  const syncScroll = () => {
    const textarea = input();

    if (textarea && backdrop.current) {
      backdrop.current.scrollTop = textarea.scrollTop;
    }
  };

  useLayoutEffect(() => {
    const position = caretAfterCompletion.current;
    caretAfterCompletion.current = undefined;
    if (position !== undefined) input()?.setSelectionRange(position, position);
    syncScroll();
  });

  const change = (value: string, { reason }: { reason: string }) => {
    setDismissed(undefined);
    if (reason === "item-press") complete(value);
    else setDraft(value);
  };

  const moveCaret = (event: SyntheticEvent<HTMLInputElement>) => {
    const { value, selectionEnd } = event.currentTarget;
    const at = selectionEnd ?? value.length;
    // Typing at the end keeps no caret, so it doesn't render the menu again.
    setCaret(at === value.length ? undefined : { draft: value, at });
  };

  const openChange = (next: boolean) => {
    if (!next) setDismissed(draft);
  };

  const keys = (event: BaseUIEvent<KeyboardEvent>) => {
    if (!open) {
      // The input's keys are for one line, so a closed menu leaves them to the textarea.
      event.preventBaseUIHandler();
      onKeyDown(event);
    } else if (event.key === "Tab" && !event.shiftKey && highlighted) {
      event.preventDefault();
      complete(highlighted.name);
    }
  };

  return (
    <Autocomplete.Root
      items={items}
      filter={null}
      value={draft}
      onValueChange={change}
      itemToStringValue={(command: ProviderCommand) => command.name}
      open={open}
      onOpenChange={openChange}
      onItemHighlighted={setHighlighted}
      // The menu also opens when the caret moves into a command, which
      // highlights only with "always".
      autoHighlight="always"
      mode="none"
    >
      <div className="command-field" ref={field} data-command={typed && ""}>
        {typed && (
          <CommandHighlight ref={backdrop} command={typed} draft={draft} />
        )}
        <Autocomplete.Input
          render={<textarea {...textarea} />}
          onKeyDown={keys}
          onScroll={syncScroll}
          onInput={moveCaret}
          onSelect={moveCaret}
        />
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="autocomplete-positioner"
          anchor={anchor}
          side="top"
          sideOffset={6}
          align="start"
        >
          <Autocomplete.Popup className="autocomplete-popup command-menu-popup">
            <Autocomplete.List>
              {(command: ProviderCommand) => (
                <Autocomplete.Item
                  key={command.name}
                  value={command}
                  className="autocomplete-item"
                  title={fullText(command)}
                >
                  <span
                    className="command-menu-text"
                    data-args={command.argument_hint ? "" : undefined}
                  >
                    <span>/{command.name}</span>
                    {command.argument_hint && (
                      <span className="command-menu-args">
                        {command.argument_hint}
                      </span>
                    )}
                    {command.description && (
                      <span className="command-menu-description">
                        {command.description}
                      </span>
                    )}
                  </span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
