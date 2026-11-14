import { Autocomplete } from "@base-ui/react/autocomplete";
import type { BaseUIEvent } from "@base-ui/react/types";
import {
  type ComponentProps,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react";

import type { ProviderCommand } from "../../../../../shared/providers/types";

/** The partial command a draft is typing, such as `comp` in `/comp`. */
export const commandQuery = (draft: string) => /^\/([^\s/]*)$/.exec(draft)?.[1];

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

type CommandMenuProps = {
  /** What the menu opens above. */
  anchor: RefObject<HTMLElement | null>;
  commands: ProviderCommand[];
  draft: string;
  onDraftChange: (value: string) => void;
  /** Keys the textarea gets while the menu is closed. */
  onKeyDown: (event: KeyboardEvent) => void;
  textarea: ComponentProps<"textarea">;
};

/** The composer's textarea, suggesting commands while the draft is `/` and a partial name. */
export function CommandMenu({
  anchor,
  commands,
  draft,
  onDraftChange,
  onKeyDown,
  textarea,
}: CommandMenuProps) {
  const query = commandQuery(draft);
  const items = query === undefined ? [] : matchingCommands(commands, query);
  // Escape hides the menu until the draft changes.
  const [dismissed, setDismissed] = useState<string>();
  const [highlighted, setHighlighted] = useState<ProviderCommand>();
  const open = items.length > 0 && dismissed !== draft;
  const complete = (name: string) => onDraftChange(`/${name} `);

  const change = (value: string, { reason }: { reason: string }) => {
    if (reason === "item-press") complete(value);
    else onDraftChange(value);
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
      autoHighlight
      mode="none"
    >
      <Autocomplete.Input
        render={<textarea {...textarea} />}
        onKeyDown={keys}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="autocomplete-positioner"
          anchor={anchor}
          side="top"
          sideOffset={6}
          align="start"
        >
          <Autocomplete.Popup className="autocomplete-popup">
            <Autocomplete.List>
              {(command: ProviderCommand) => (
                <Autocomplete.Item
                  key={command.name}
                  value={command}
                  className="autocomplete-item"
                >
                  <span className="select-item-text">
                    <span>
                      /{command.name}
                      {command.argument_hint && (
                        <span className="model-id">
                          {" "}
                          {command.argument_hint}
                        </span>
                      )}
                    </span>
                    {command.description && (
                      <span className="select-item-description">
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
