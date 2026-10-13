import "../../../src/panel/styles/base.css";
import "../../../src/panel/styles/theme.css";
import "../../../src/panel/shared/components/motion/motion.css";
import "./field-error-demo.css";

import { Collapsible } from "@base-ui/react/collapsible";
import {
  type TransitionEvent,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { Presence } from "../../../src/panel/shared/components/motion/motion";
import {
  MOTION,
  reducedMotion,
} from "../../../src/panel/shared/components/motion/motion-utils";

const FIELD_ERROR = "Enter a limit higher than $5.00.";

type ErrorMode = "plain" | "presence" | "base-ui";

const modes: {
  id: ErrorMode;
  title: string;
  description: string;
}[] = [
  {
    id: "plain",
    title: "FormSelect style",
    description: "Fades in on show; clears immediately when valid.",
  },
  {
    id: "presence",
    title: "Presence",
    description: "Folds in and out while keeping the last message visible.",
  },
  {
    id: "base-ui",
    title: "Base UI Collapsible",
    description: "Uses Base UI’s measured height for a smooth fold.",
  },
];

function FieldErrorExample({
  id,
  mode,
  invalid,
}: {
  id: string;
  mode: ErrorMode;
  invalid: boolean;
}) {
  const [retainedError, setRetainedError] = useState<string>();

  useLayoutEffect(() => {
    if (invalid) setRetainedError(FIELD_ERROR);
  }, [invalid]);

  useEffect(() => {
    if (mode !== "base-ui" || invalid || !retainedError) return;

    if (reducedMotion()) {
      setRetainedError(undefined);

      return;
    }

    const timeout = window.setTimeout(
      () => setRetainedError(undefined),
      MOTION.base + 50,
    );

    return () => window.clearTimeout(timeout);
  }, [invalid, mode, retainedError]);

  const clearClosedError = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      mode !== "base-ui" ||
      event.target !== event.currentTarget ||
      event.propertyName !== "height" ||
      invalid
    )
      return;

    setRetainedError(undefined);
  };

  const message = (
    <p
      id={id}
      className={`demo-error ${mode === "plain" ? "form-error" : ""}`}
      role="alert"
    >
      {FIELD_ERROR}
    </p>
  );

  let errorContent;

  if (mode === "plain") errorContent = invalid ? message : null;
  else if (mode === "presence")
    errorContent = <Presence show={invalid}>{message}</Presence>;
  else
    errorContent = (
      <Collapsible.Root open={invalid}>
        <Collapsible.Panel
          className="collapse-panel demo-collapse-panel"
          keepMounted
          onTransitionEnd={clearClosedError}
        >
          {retainedError && (
            <div className="demo-collapse-content">
              <p id={id} className="demo-error" role="alert">
                {retainedError}
              </p>
            </div>
          )}
        </Collapsible.Panel>
      </Collapsible.Root>
    );

  return (
    <div className="demo-field-example">
      <label htmlFor={`${id}-input`}>Cost limit</label>
      <div className={`demo-input ${invalid ? "is-invalid" : ""}`}>
        <span aria-hidden="true">$</span>
        <input
          id={`${id}-input`}
          type="number"
          value={invalid ? "4" : "5"}
          readOnly
          aria-invalid={invalid}
          aria-describedby={invalid ? id : undefined}
        />
      </div>
      {errorContent}
    </div>
  );
}

function FieldErrorCard({
  mode,
  invalid,
  pending,
  onPreview,
}: {
  mode: (typeof modes)[number];
  invalid: boolean;
  pending: boolean;
  onPreview: () => void;
}) {
  let previewLabel = "Preview";
  if (pending) previewLabel = "Switching…";
  else if (invalid) previewLabel = "Hide preview";

  return (
    <section className="demo-card" aria-labelledby={`${mode.id}-title`}>
      <div className="demo-card-heading">
        <div className="demo-card-copy">
          <h2 id={`${mode.id}-title`}>{mode.title}</h2>
          <span className="demo-mode-tag">
            {mode.id === "plain" ? "Fade in only" : "Show + hide"}
          </span>
        </div>
        <button
          type="button"
          className="demo-preview-button"
          aria-pressed={invalid}
          aria-busy={pending}
          disabled={pending}
          onClick={onPreview}
        >
          {previewLabel}
        </button>
      </div>
      <p className="demo-description">{mode.description}</p>
      <FieldErrorExample
        id={`${mode.id}-error`}
        mode={mode.id}
        invalid={invalid}
      />
    </section>
  );
}

function FieldErrorDemo() {
  const [activeMode, setActiveMode] = useState<ErrorMode | null>(null);
  const [pendingMode, setPendingMode] = useState<ErrorMode | null>(null);
  const [closingMode, setClosingMode] = useState<ErrorMode | null>(null);

  useEffect(() => {
    if (activeMode || !pendingMode) return;

    const timeout = window.setTimeout(
      () => {
        setActiveMode(pendingMode);
        setPendingMode(null);
        setClosingMode(null);
      },
      closingMode && closingMode !== "plain" && !reducedMotion()
        ? MOTION.base + 50
        : 0,
    );

    return () => window.clearTimeout(timeout);
  }, [activeMode, closingMode, pendingMode]);

  const preview = (mode: ErrorMode) => {
    if (activeMode === mode) {
      setActiveMode(null);
      setPendingMode(null);
      setClosingMode(null);

      return;
    }

    if (activeMode) {
      setClosingMode(activeMode);
      setPendingMode(mode);
      setActiveMode(null);

      return;
    }

    if (pendingMode) {
      setPendingMode(mode);

      return;
    }

    setActiveMode(mode);
  };

  return (
    <main className="demo-shell">
      <header className="demo-header">
        <div>
          <p className="demo-eyebrow">Interaction comparison</p>
          <h1>Field error motion</h1>
          <p className="demo-intro">
            Preview one mode at a time. Switching waits for the current motion
            to finish.
          </p>
        </div>
      </header>
      <div className="demo-grid">
        {modes.map((mode) => (
          <FieldErrorCard
            key={mode.id}
            mode={mode}
            invalid={activeMode === mode.id}
            pending={pendingMode === mode.id}
            onPreview={() => preview(mode.id)}
          />
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<FieldErrorDemo />);
