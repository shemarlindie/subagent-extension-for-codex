import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../components/button/button";
import { Presence } from "../components/motion/presence";

interface FormFooterProps {
  label: string;
  disabled?: boolean;
  dismissLabel?: string;
  /** Other actions, placed before the submit button. */
  children?: ReactNode;
}

export function FormFooter({
  label,
  disabled = false,
  dismissLabel = "Cancel",
  children,
}: FormFooterProps) {
  const controller = useController(),
    state = useSnapshot(),
    stale = state.dialog?.scope !== state.scopeVersion;

  return (
    <>
      <Presence show={Boolean(state.formError)}>
        <div id="form-error" className="form-error error" role="alert">
          {state.formError}
        </div>
      </Presence>
      <footer>
        <Dialog.Close
          type="button"
          id="dismiss"
          disabled={state.busy}
          onClick={() => controller.dismiss()}
        >
          {dismissLabel}
        </Dialog.Close>
        {children}
        <Button
          id="submit"
          type="submit"
          variant="primary"
          disabled={state.busy || stale || disabled}
        >
          {state.busy ? "Working…" : label}
        </Button>
      </footer>
    </>
  );
}
