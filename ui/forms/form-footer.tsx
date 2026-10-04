import { Dialog } from "@base-ui/react/dialog";
import { useController, useSnapshot } from "../components/controller-context";
interface FormFooterProps {
  label: string;
  disabled?: boolean;
}
export function FormFooter({ label, disabled = false }: FormFooterProps) {
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
          Cancel
        </Dialog.Close>
        <button
          id="submit"
          className="primary"
          disabled={state.busy || stale || disabled}
        >
          {state.busy ? "Working…" : label}
        </button>
      </footer>
    </>
  );
}
