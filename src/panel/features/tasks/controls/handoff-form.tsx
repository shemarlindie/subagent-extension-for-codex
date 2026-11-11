import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import {
  defineDialog,
  firstTextField,
} from "../../../shared/dialogs/dialog-definition";
import { Field } from "../../../shared/forms/fields";
import { FormFooter } from "../../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../../shared/forms/use-persisted-dialog-form";
import { handoffMessage, type HandoffTarget } from "./handoff-message";

type HandoffFormProps = {
  task: Task;
  target?: HandoffTarget;
};

function footerLabel(canSend: boolean, canCopy: boolean) {
  if (canSend) return "Send to conversation";
  if (canCopy) return "Copy message";

  return "Done";
}

function HandoffForm({ task, target }: HandoffFormProps) {
  const controller = useController();
  const canSend = useSnapshot((state) => state.host.canSend);
  // Without a host to send to, a standalone page falls back to the clipboard.
  const canCopy = !controller.transport.embedded;

  const { register, handleSubmit } = usePersistedDialogForm("handoff", {
    message: handoffMessage(task, target),
  });

  return (
    <form
      className="handoff-form"
      onSubmit={controller.handle(
        handleSubmit((values) =>
          controller.submit(async () => {
            if (canSend) {
              await controller.transport.send?.(values.message);
            } else if (canCopy) {
              await navigator.clipboard.writeText(values.message);
            }
          }),
        ),
      )}
    >
      {!canSend && !canCopy && (
        <p className="form-note">Select and copy this message into Codex.</p>
      )}
      <Field id="handoff-message" label="Message">
        <textarea
          id="handoff-message"
          rows={12}
          required
          {...register("message", { required: true })}
        />
      </Field>
      <FormFooter dismissLabel="Close" label={footerLabel(canSend, canCopy)} />
    </form>
  );
}

export const handoffDialog = defineDialog<"handoff">({
  title: ({ target }) =>
    target ? `Ask Codex about this ${target.kind}` : "Bring task to Codex",
  render: ({ task, target }) => <HandoffForm task={task} target={target} />,
  initialFocus: firstTextField,
  restoreFocus: () => document.getElementById("task-menu"),
});
