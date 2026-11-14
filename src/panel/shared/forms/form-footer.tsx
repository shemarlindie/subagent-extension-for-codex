import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import { dialogStale } from "../../app/state/scope-reconciliation";
import { Button } from "../components/button/button";
import { Presence } from "../components/motion/presence";

interface FormFooterProps {
  label: string;
  disabled?: boolean;
  dismissLabel?: string;
  leading?: ReactNode;
  /** Other actions, placed before the submit button. */
  children?: ReactNode;
}

export function FormFooter({
  label,
  disabled = false,
  dismissLabel = "Cancel",
  leading,
  children,
}: FormFooterProps) {
  const controller = useController();

  const { formError, busy, stale } = useSnapshot(
    ["formError", "busy"],
    (state) => ({ stale: dialogStale(state) }),
  );

  return (
    <>
      <Presence show={Boolean(formError)}>
        <div id="form-error" className="form-error error" role="alert">
          {formError}
        </div>
      </Presence>
      <footer>
        {leading && <div className="form-footer-leading">{leading}</div>}
        <Dialog.Close
          type="button"
          id="dismiss"
          disabled={busy}
          onClick={() => controller.dismiss()}
        >
          {dismissLabel}
        </Dialog.Close>
        {children}
        <Button
          id="submit"
          type="submit"
          variant="primary"
          disabled={busy || stale || disabled}
        >
          {busy ? "Working…" : label}
        </Button>
      </footer>
    </>
  );
}
