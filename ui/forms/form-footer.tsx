import { Dialog } from "@base-ui/react/dialog";
import { useController, useSnapshot } from "../components/controller-context";
export function FormFooter({ label }: { label: string }) {
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
        <button id="submit" className="primary" disabled={state.busy || stale}>
          {state.busy ? "Working…" : label}
        </button>
      </footer>
    </>
  );
}
