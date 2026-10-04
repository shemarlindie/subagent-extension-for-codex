import { Dialog } from "@base-ui/react/dialog";
import { useController, useSnapshot } from "../components/controller-context";
import { Button } from "../components/button";

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
      <div id="form-error" className="form-error error" role="alert">
        {state.formError}
      </div>
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
