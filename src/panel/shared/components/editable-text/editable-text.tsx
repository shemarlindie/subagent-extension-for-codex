import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type EditableTextProps = {
  value: string;
  label: string;
  maxLength?: number;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
};

type TextControl = HTMLInputElement | HTMLTextAreaElement;

type TextLayout = { multiline: boolean; height: number };

type TextSelection = { start: number; end: number };

/** Inline text editing with keyboard/outside saves and retryable failures. */
export function EditableText({
  value,
  label,
  maxLength,
  disabled = false,
  onSave,
}: EditableTextProps) {
  const errorId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const control = useRef<TextControl>(null);
  const selection = useRef<TextSelection | undefined>(undefined);
  const saving = useRef(false);
  const restoreFocus = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [layout, setLayout] = useState<TextLayout>({
    multiline: false,
    height: 32,
  });

  const focusControl = useCallback(
    (element: TextControl | null) => {
      control.current = element;
      if (!element || !editing) return;
      element.focus({ preventScroll: true });

      if (selection.current) {
        element.setSelectionRange(
          selection.current.start,
          selection.current.end,
        );
      }
    },
    [editing],
  );

  useLayoutEffect(() => {
    const element = measure.current;
    if (!element) return;

    const update = () => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 28;
      const textHeight = element.getBoundingClientRect().height;
      const multiline = textHeight > lineHeight + 1;
      const height = Math.max(lineHeight, textHeight) + 4;

      setLayout((previous) =>
        previous.multiline === multiline && previous.height === height
          ? previous
          : { multiline, height },
      );
    };

    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => observer.disconnect();
  }, [draft, editing, value]);

  // Native fields can scroll the caret while the new wrapped height is being
  // measured. The field grows to fit its text, so it never needs internal scroll.
  useLayoutEffect(() => {
    const element = control.current;
    if (!element) return;
    element.scrollTop = 0;
    element.scrollLeft = 0;
  }, [draft, editing, layout.height, layout.multiline]);

  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) {
      trigger.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [editing]);

  const finish = useCallback((focus = true) => {
    restoreFocus.current = focus;
    setEditing(false);
    setError("");
  }, []);

  const save = useCallback(
    async (focus = true) => {
      const text = draft.trim();
      if (disabled || saving.current || !text) return;
      if (text === value) return finish(focus);
      saving.current = true;
      setBusy(true);
      setError("");

      try {
        await onSave(text);
        finish(focus);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not save changes",
        );
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [draft, value, onSave, finish, disabled],
  );

  useEffect(() => {
    const element = root.current;
    if (!editing || !element) return;

    const saveOutside = (event: PointerEvent) => {
      if (saving.current || element.contains(event.target as Node)) return;
      void save(false);
    };

    const document = element.ownerDocument;
    document.addEventListener("pointerdown", saveOutside, true);

    return () => document.removeEventListener("pointerdown", saveOutside, true);
  }, [editing, save]);

  const fieldProps = {
    "aria-label": editing ? label : undefined,
    "aria-invalid": Boolean(error) || undefined,
    "aria-describedby": error ? errorId : undefined,
    value: editing ? draft : value,
    readOnly: !editing,
    style: layout.multiline ? { height: layout.height } : undefined,
    maxLength,
    required: true,
    disabled: busy || disabled,
    ref: focusControl,
    onChange: (event: React.ChangeEvent<TextControl>) => {
      selection.current = {
        start: event.target.selectionStart ?? event.target.value.length,
        end: event.target.selectionEnd ?? event.target.value.length,
      };

      setDraft(event.target.value);
    },
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    // Enter and Escape belong to the IME until composition finishes.
    if (event.nativeEvent.isComposing) return;

    if (editing && event.key === "Escape" && !saving.current) {
      event.preventDefault();
      control.current?.blur();
      finish(false);
    }

    if (event.key === "Enter" && event.target === control.current) {
      event.preventDefault();
      void save();
    }
  };

  const startEditing = () => {
    selection.current = undefined;
    setDraft(value);
    setError("");
    setEditing(true);
  };

  return (
    <span
      ref={root}
      className="editable-text"
      data-editing={editing || undefined}
      data-multiline={layout.multiline || undefined}
      onKeyDown={handleKeyDown}
    >
      <span
        ref={measure}
        className="editable-text-measure"
        aria-hidden="true"
        data-value={(editing ? draft : value) || " "}
      />
      <span
        className="editable-text-editor"
        data-multiline={layout.multiline || undefined}
        style={{ height: layout.height }}
        aria-hidden={!editing}
        inert={!editing}
      >
        {layout.multiline ? (
          <textarea {...fieldProps} rows={1} />
        ) : (
          <input {...fieldProps} type="text" />
        )}
      </span>
      {!editing && (
        <button
          ref={trigger}
          type="button"
          className="editable-text-trigger"
          disabled={disabled}
          title={value}
          aria-label={`Edit ${label.toLowerCase()}: ${value}`}
          onClick={startEditing}
        >
          <span className="visually-hidden">{value}</span>
        </button>
      )}
      {error && (
        <span id={errorId} className="form-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
