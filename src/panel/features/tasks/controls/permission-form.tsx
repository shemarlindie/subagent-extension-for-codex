import { Dialog } from "@base-ui/react/dialog";

import { inputPresentation } from "../../../../shared/providers/input-presentation.js";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import {
  defineDialog,
  firstTextField,
} from "../../../shared/dialogs/dialog-definition";
import { Field } from "../../../shared/forms/fields";
import { usePersistedDialogForm } from "../../../shared/forms/use-persisted-dialog-form";
import { PermissionInputDetails } from "./permission-input-details";

export function PermissionForm({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    request = task.pending_input!,
    presentation = inputPresentation(request);

  const { register, handleSubmit } = usePersistedDialogForm("respond", {
    response: "",
  });

  const disabled = state.busy || state.dialog?.scope !== state.scopeVersion;

  const decide = (approved: boolean) =>
    handleSubmit((values) =>
      controller.submit(async () => {
        await controller.tool("submit_agent_input", {
          task_id: task.id,
          request_id: request.id,
          approved,
          message: values.response,
        });
      }),
    );

  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <p className="form-note">{presentation.description}</p>
      <p className="form-note">
        Tool: <code>{request.tool}</code>
      </p>
      <PermissionInputDetails input={request.input} />
      <Field id="response" label="Message (optional)">
        <textarea id="response" maxLength={20000} {...register("response")} />
      </Field>
      <div id="form-error" className="form-error error" role="alert">
        {state.formError}
      </div>
      <footer>
        <Dialog.Close
          type="button"
          disabled={state.busy}
          onClick={() => controller.dismiss()}
        >
          Close
        </Dialog.Close>
        <Button disabled={disabled} onClick={decide(false)}>
          Deny
        </Button>
        <Button variant="primary" disabled={disabled} onClick={decide(true)}>
          {presentation.approveLabel}
        </Button>
      </footer>
    </form>
  );
}

export const permissionDialog = defineDialog<"respond">({
  title: () => "Review permission request",
  // Worker questions answer inline in Chat instead.
  render: ({ task }) => <PermissionForm task={task} />,
  initialFocus: firstTextField,
});
