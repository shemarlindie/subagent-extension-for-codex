import { useForm } from "react-hook-form";

import { useController, useSnapshot } from "../components/controller-context";
import type { Task } from "../core/types";
import { defineDialog, firstTextField } from "./dialog-definition";
import { Field } from "./fields";
import { FormFooter } from "./form-footer";

export function handoffMessage(task: Task) {
  return `Review delegated task ${task.id}: ${task.title} (${task.provider}, ${task.status}).\nRetrieve current state with get_agent_task, full results with get_agent_result, and reports/patches with get_agent_artifacts using task_id=${JSON.stringify(task.id)}. Inspect the evidence before proposing next steps or applying changes.\n\nRepository: ${task.repository}\nRevision: ${task.revision}\nDescription excerpt: ${task.description.slice(0, 1500)}${task.description.length > 1500 ? "… (truncated)" : ""}\nSummary excerpt: ${task.result?.summary.slice(0, 2500) ?? "No result yet."}${(task.result?.summary.length ?? 0) > 2500 ? "… (truncated)" : ""}`;
}

export function HandoffForm({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    canSend = state.host.canSend,
    // Without a host to send to, a standalone page falls back to the clipboard.
    canCopy = !controller.transport.embedded;

  const { register, handleSubmit } = useForm({
    defaultValues: { message: handoffMessage(task) },
  });

  return (
    <form
      className="handoff-form"
      onSubmit={handleSubmit((values) =>
        controller.submit(async () => {
          if (canSend) await controller.transport.send?.(values.message);
          else if (canCopy) await navigator.clipboard.writeText(values.message);
        }),
      )}
    >
      <p className="form-note">
        {canSend
          ? "Review or edit the message before sending it to this conversation."
          : "Select and copy this message into Codex."}
      </p>
      <Field id="handoff-message" label="Message">
        <textarea
          id="handoff-message"
          rows={12}
          required
          {...register("message", { required: true })}
        />
      </Field>
      <FormFooter
        dismissLabel="Close"
        label={
          canSend ? "Send to conversation" : canCopy ? "Copy message" : "Done"
        }
      />
    </form>
  );
}

export const handoffDialog = defineDialog<"handoff">({
  title: () => "Bring task to Codex",
  render: ({ task }) => <HandoffForm task={task} />,
  initialFocus: firstTextField,
});
