import {
  defineDialog,
  firstTextField,
} from "../../../shared/dialogs/dialog-definition";
import { Field } from "../../../shared/forms/fields";
import { FormFooter } from "../../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../../shared/forms/use-persisted-dialog-form";
import { useController } from "../../../shared/state/controller-context";
import type { DialogState, Task } from "../../../shared/state/types";
import { TaskDescription } from "../inspector/task-description";

export function controlTitle(action: string) {
  return (
    (
      {
        steer: "Steer task",
        continue: "Continue task",
        interrupt: "Interrupt task?",
      } as Record<string, string>
    )[action] ?? "Task action"
  );
}

interface ControlFormProps {
  dialog: Extract<DialogState, { kind: "control" }>;
}

export function ControlForm({ dialog }: ControlFormProps) {
  const controller = useController(),
    { action, task } = dialog;

  const { register, handleSubmit } = usePersistedDialogForm<{
    instruction: string;
  }>("control", { instruction: "" });

  const instruction = action === "steer" || action === "continue";

  const descriptions: Record<string, string> = {
    steer:
      "The running turn takes your instruction after its next tool call, without stopping.",
    continue: "Start the next turn in this task, in its workspace and session.",
    interrupt:
      "Stop current execution and preserve the workspace and session for continuation.",
  };

  const labels: Record<string, string> = {
    steer: "Send instruction",
    continue: "Continue",
    interrupt: "Interrupt",
  };

  const tools: Record<string, string> = {
    steer: "send_agent_instruction",
    continue: "continue_agent_task",
    interrupt: "interrupt_agent_task",
  };

  return (
    <form
      onSubmit={handleSubmit((values) =>
        controller.submit(() =>
          controller.tool<Task>(tools[action], {
            task_id: task.id,
            ...(values.instruction?.trim()
              ? { message: values.instruction }
              : {}),
          }),
        ),
      )}
    >
      <p className="form-note">{descriptions[action]}</p>
      {instruction ? (
        <Field
          id="instruction"
          label={
            action === "steer" ? "New instruction" : "Instruction (optional)"
          }
        >
          <textarea
            id="instruction"
            maxLength={20000}
            required={action === "steer"}
            {...register("instruction", { required: action === "steer" })}
          />
        </Field>
      ) : (
        <>
          <p>{task.title}</p>
          <TaskDescription task={task} defaultOpen={action === "interrupt"} />
        </>
      )}
      <FormFooter label={labels[action]} dismissLabel="Close" />
    </form>
  );
}

export const controlDialog = defineDialog<"control">({
  title: ({ action }) => controlTitle(action),
  render: (dialog) => <ControlForm dialog={dialog} />,
  initialFocus: firstTextField,
});
