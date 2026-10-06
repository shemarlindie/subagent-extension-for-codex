import { Dialog } from "@base-ui/react/dialog";

import { Button } from "../components/button";
import { Presence } from "../components/motion";
import { useController, useSnapshot } from "../state/controller-context";

interface FormFooterProps {
  label: string;
  disabled?: boolean;
  dismissLabel?: string;
}

export function FormFooter({
  label,
  disabled = false,
  dismissLabel = "Cancel",
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
