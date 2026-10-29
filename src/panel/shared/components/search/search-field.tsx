import { Input } from "@base-ui/react/input";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
} from "react";

import { Button } from "../button/button";
import { Icon } from "../icons/icons";

interface SearchFieldProps {
  label: string;
  clearLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Focus this field with "/" while its page is visible. */
  focusShortcut?: boolean;
  blurOnEmptyEscape?: boolean;
}

// Typing a "/" into a text field or a dialog must not be hijacked by the shortcut.
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
    target.closest('[role="dialog"]') !== null);

/** Controlled search with a clear button and consistent keyboard handling. */
export function SearchField({
  label,
  clearLabel,
  value,
  onValueChange,
  disabled,
  className,
  focusShortcut = false,
  blurOnEmptyEscape = false,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);

  // Retained pages stay mounted while hidden, so only a visible field responds.
  useEffect(() => {
    if (!focusShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const field = input.current;

      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typing(event.target) ||
        !field ||
        field.disabled ||
        field.closest("[hidden], [inert]")
      ) {
        return;
      }

      event.preventDefault();
      field.focus();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusShortcut]);

  const clear = () => {
    onValueChange("");
    input.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.preventDefault();
    if (event.key !== "Escape") return;

    if (value) {
      event.preventDefault();
      event.stopPropagation();
      clear();
    } else if (blurOnEmptyEscape) {
      event.currentTarget.blur();
    }
  };

  return (
    <div className={["search-box", className].filter(Boolean).join(" ")}>
      <Icon name="search" size={10} className="search-icon" />
      <Input
        ref={input}
        className="search"
        type="search"
        aria-label={label}
        aria-keyshortcuts={focusShortcut ? "/" : undefined}
        placeholder={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <Button
          variant="text"
          className="search-clear"
          aria-label={clearLabel}
          disabled={disabled}
          onClick={clear}
        >
          <Icon name="close" size={8} />
        </Button>
      ) : (
        focusShortcut &&
        !disabled && (
          // aria-keyshortcuts announces the shortcut, so the hint is visual only.
          <kbd className="search-shortcut" aria-hidden="true">
            /
          </kbd>
        )
      )}
    </div>
  );
}
