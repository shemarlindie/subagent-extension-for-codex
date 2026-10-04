import { defineDialog, firstTextField } from "./dialog-definition";
import { useForm } from "react-hook-form";
import { Dialog } from "@base-ui/react/dialog";
import type { Task } from "../core/types";
import { useController, useSnapshot } from "../components/controller-context";
import { Button } from "../components/button";
import { Field } from "./fields";
export function PermissionForm({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    request = task.pending_input!;
  const { register, handleSubmit } = useForm({
    defaultValues: { response: "" },
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
      <p className="form-note">
        {request.tool === "CodexExecution"
          ? "Approval covers the entire execution turn, including shell commands."
          : "Review the full request before allowing the worker to proceed."}
      </p>
      <pre>{JSON.stringify(request.input, null, 2)}</pre>
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
          {request.tool === "CodexExecution"
            ? "Approve this execution turn"
            : "Approve this request once"}
        </Button>
      </footer>
    </form>
  );
}
export const permissionDialog = defineDialog<"respond">({
  title: () => "Review permission request",
  // Worker questions answer inline in the task notice instead.
  render: ({ task }) => <PermissionForm task={task} />,
  initialFocus: firstTextField,
});
