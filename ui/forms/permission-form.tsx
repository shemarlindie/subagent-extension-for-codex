import { useForm } from "react-hook-form";
import type { Task } from "../core/types";
import { useController } from "../components/controller-context";
import { Field } from "./fields";
import { FormSelect } from "./form-select";
import { FormFooter } from "./form-footer";
export function PermissionForm({ task }: { task: Task }) {
  const controller = useController(),
    request = task.pending_input!;
  const { register, control, handleSubmit } = useForm({
    defaultValues: { decision: "deny", response: "" },
  });
  return (
    <form
      onSubmit={handleSubmit((values) =>
        controller.submit(async () => {
          await controller.tool("submit_agent_input", {
            task_id: task.id,
            request_id: request.id,
            approved: values.decision === "approve",
            message: values.response,
          });
        }),
      )}
    >
      <p className="form-note">
        {request.tool === "CodexExecution"
          ? "Approval covers the entire execution turn, including shell commands."
          : "Review the full request before allowing the worker to proceed."}
      </p>
      <pre>{JSON.stringify(request.input, null, 2)}</pre>
      <Field id="decision" label="Decision">
        <FormSelect
          control={control}
          name="decision"
          id="decision"
          label="Decision"
          options={[
            { value: "deny", label: "Deny" },
            {
              value: "approve",
              label:
                request.tool === "CodexExecution"
                  ? "Approve this execution turn"
                  : "Approve this request once",
            },
          ]}
        />
      </Field>
      <Field id="response" label="Message (optional)">
        <textarea id="response" maxLength={20000} {...register("response")} />
      </Field>
      <FormFooter label="Submit decision" />
    </form>
  );
}
